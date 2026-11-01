"""Who teaches what: each class's class teacher, the subjects it takes and each subject's teacher."""
import re
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.access import not_found, owned_branch
from app.api.deps import current_user
from app.api.staff import STAFF_ROLES
from app.core.db import get_db
from app.models import (
    TeachingGroup, StudentElective, Branch, ClassSubject, Department, Membership, Role, SchoolClass, StaffProfile, Student, StudentStatus, Subject, User,
)

router = APIRouter(prefix="/api", tags=["teaching"])

# The usual subjects by stage. (name, compulsory). Only subjects the school has are used.
_BASIC = [("English Language", True), ("Mathematics", True), ("Basic Science", True), ("Basic Technology", True),
          ("Social Studies", True), ("Civic Education", True), ("Christian Religious Studies", False),
          ("Islamic Religious Studies", False), ("Agricultural Science", True), ("Home Economics", True),
          ("Business Studies", True), ("Computer Studies", True), ("Cultural and Creative Arts", True),
          ("Physical and Health Education", True), ("French", True), ("Igbo", False), ("Yoruba", False), ("Hausa", False)]
_PRIMARY = [x for x in _BASIC if x[0] not in ("Business Studies", "Basic Technology")]
_SENIOR = [("English Language", True), ("Mathematics", True), ("Civic Education", True), ("Biology", True),
           ("Physics", False), ("Chemistry", False), ("Further Mathematics", False), ("Agricultural Science", False),
           ("Economics", False), ("Government", False), ("Literature in English", False), ("Geography", False),
           ("Financial Accounting", False), ("Commerce", False), ("Technical Drawing", False), ("Computer Studies", False),
           ("Christian Religious Studies", False), ("Islamic Religious Studies", False)]
_EARLY = [("English Language", True), ("Mathematics", True), ("Basic Science", True), ("Social Studies", True),
          ("Cultural and Creative Arts", True), ("Christian Religious Studies", False), ("Islamic Religious Studies", False)]


def standard_for(level: str) -> list[tuple[str, bool]]:
    l = level.lower()
    if l.startswith("ss"):
        return _SENIOR
    if l.startswith("jss"):
        return _BASIC
    if l.startswith("primary"):
        return _PRIMARY
    return _EARLY


class TeacherOut(BaseModel):
    user_id: uuid.UUID
    full_name: str
    title: str | None
    job_title: str | None
    department_name: str | None
    teaching: bool


class SlotOut(BaseModel):
    id: uuid.UUID
    subject_id: uuid.UUID
    subject_name: str
    department_name: str | None
    teacher_user_id: uuid.UUID | None
    teacher_name: str | None
    compulsory: bool
    in_groups: bool = False                 # SS electives are taught in groups across the level
    group_teachers: list[str] = []


class ClassOut(BaseModel):
    id: uuid.UUID
    name: str
    level: str
    arm: str
    student_count: int
    form_teacher_id: uuid.UUID | None
    form_teacher_name: str | None
    subjects: list[SlotOut]


class GroupLoad(BaseModel):
    teacher_user_id: uuid.UUID | None
    level: str
    subject_name: str
    students: int


class TeachingOut(BaseModel):
    classes: list[ClassOut]
    teachers: list[TeacherOut]
    groups: list[GroupLoad] = []


def staff_ids(db: Session, branch_id: uuid.UUID) -> set[uuid.UUID]:
    return set(db.scalars(select(Membership.user_id).where(Membership.branch_id == branch_id, Membership.role.in_(STAFF_ROLES))))


def teaching_view(db: Session, branch: Branch) -> TeachingOut:
    classes = list(db.scalars(select(SchoolClass).where(SchoolClass.branch_id == branch.id)
                              .order_by(SchoolClass.level_order, SchoolClass.level, SchoolClass.arm)))
    counts = dict(db.execute(select(Student.class_id, func.count()).where(
        Student.branch_id == branch.id, Student.status == StudentStatus.active).group_by(Student.class_id)).all())
    ids = staff_ids(db, branch.id)
    users = {u.id: u for u in db.scalars(select(User).where(User.id.in_(ids)))} if ids else {}
    profiles = {p.user_id: p for p in db.scalars(select(StaffProfile).where(StaffProfile.school_id == branch.school_id))}
    roles: dict[uuid.UUID, set[Role]] = {}
    for uid, role in db.execute(select(Membership.user_id, Membership.role).where(
            Membership.branch_id == branch.id, Membership.role.in_(STAFF_ROLES))):
        roles.setdefault(uid, set()).add(role)
    subjects = {s.id: s for s in db.scalars(select(Subject).where(Subject.school_id == branch.school_id))}
    depts = {d.id: d.name for d in db.scalars(select(Department).where(Department.school_id == branch.school_id))}
    slots: dict[uuid.UUID, list[ClassSubject]] = {}
    if classes:
        for cs in db.scalars(select(ClassSubject).where(ClassSubject.class_id.in_([c.id for c in classes]))):
            slots.setdefault(cs.class_id, []).append(cs)

    def name(uid):
        u = users.get(uid) or (db.get(User, uid) if uid else None)
        if not u:
            return None
        p = profiles.get(uid)
        return " ".join(x for x in [p.title if p else None, u.full_name] if x)

    group_teachers: dict[tuple[str, uuid.UUID], list[str]] = {}
    group_loads: list[GroupLoad] = []
    sizes = dict(db.execute(select(StudentElective.group_id, func.count()).where(StudentElective.group_id.is_not(None))
                            .group_by(StudentElective.group_id)).all())
    for g in db.scalars(select(TeachingGroup).where(TeachingGroup.branch_id == branch.id).order_by(TeachingGroup.name)):
        group_teachers.setdefault((g.level, g.subject_id), []).append(name(g.teacher_user_id) or "No teacher yet")
        group_loads.append(GroupLoad(teacher_user_id=g.teacher_user_id, level=g.level,
                                     subject_name=subjects[g.subject_id].name, students=sizes.get(g.id, 0)))

    out_classes = []
    for c in classes:
        senior = c.level.upper().startswith("SS")
        mine = sorted(slots.get(c.id, []), key=lambda x: (not x.compulsory, subjects[x.subject_id].name.lower()))
        out_classes.append(ClassOut(
            id=c.id, name=c.name, level=c.level, arm=c.arm, student_count=counts.get(c.id, 0),
            form_teacher_id=c.form_teacher_id, form_teacher_name=name(c.form_teacher_id),
            subjects=[SlotOut(id=x.id, subject_id=x.subject_id, subject_name=subjects[x.subject_id].name,
                              department_name=depts.get(subjects[x.subject_id].department_id),
                              teacher_user_id=x.teacher_user_id, teacher_name=name(x.teacher_user_id), compulsory=x.compulsory,
                              in_groups=senior and not x.compulsory,
                              group_teachers=group_teachers.get((c.level, x.subject_id), []) if senior and not x.compulsory else [])
                      for x in mine],
        ))

    def is_teaching(uid):
        p = profiles.get(uid)
        r = roles.get(uid, set())
        return (p.teaching if p else True) and bool(r & {Role.teacher, Role.head_of_school, Role.head, Role.vice_principal, Role.house_parent})
    teachers = [TeacherOut(user_id=u.id, full_name=u.full_name, title=profiles[u.id].title if u.id in profiles else None,
                           job_title=profiles[u.id].job_title if u.id in profiles else None,
                           department_name=depts.get(profiles[u.id].department_id) if u.id in profiles else None,
                           teaching=is_teaching(u.id))
                for u in users.values()]
    teachers.sort(key=lambda t: (not t.teaching, t.full_name.lower()))
    return TeachingOut(classes=out_classes, teachers=teachers, groups=group_loads)


def own_class(db: Session, user: User, class_id: uuid.UUID) -> tuple[SchoolClass, Branch]:
    c = db.get(SchoolClass, class_id)
    if not c:
        raise not_found("Class")
    return c, owned_branch(db, user, c.branch_id)


def check_teacher(db: Session, branch: Branch, user_id: uuid.UUID | None) -> None:
    if user_id and user_id not in staff_ids(db, branch.id):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "That person isn't on the staff of this school")


def set_offering(db: Session, cls: SchoolClass, wanted: list[tuple[uuid.UUID, bool]]) -> None:
    """Makes the class take exactly these subjects, keeping teachers already chosen."""
    current = {cs.subject_id: cs for cs in db.scalars(select(ClassSubject).where(ClassSubject.class_id == cls.id))}
    keep = {sid for sid, _ in wanted}
    for sid, cs in current.items():
        if sid not in keep:
            db.delete(cs)
    for sid, compulsory in wanted:
        if sid in current:
            current[sid].compulsory = compulsory
        else:
            db.add(ClassSubject(class_id=cls.id, subject_id=sid, compulsory=compulsory))
    db.flush()


@router.get("/branches/{branch_id}/teaching", response_model=TeachingOut)
def get_teaching(branch_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return teaching_view(db, owned_branch(db, user, branch_id))


class FormTeacherIn(BaseModel):
    user_id: uuid.UUID | None


@router.put("/classes/{class_id}/form-teacher", response_model=TeachingOut)
def set_form_teacher(class_id: uuid.UUID, data: FormTeacherIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    cls, branch = own_class(db, user, class_id)
    check_teacher(db, branch, data.user_id)
    cls.form_teacher_id = data.user_id
    db.commit()
    return teaching_view(db, branch)


class OfferIn(BaseModel):
    subject_id: uuid.UUID
    compulsory: bool = True


class OfferingIn(BaseModel):
    subjects: list[OfferIn]
    also_class_ids: list[uuid.UUID] = []   # give these classes the same subjects too


@router.put("/classes/{class_id}/subjects", response_model=TeachingOut)
def set_class_subjects(class_id: uuid.UUID, data: OfferingIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    cls, branch = own_class(db, user, class_id)
    valid = set(db.scalars(select(Subject.id).where(Subject.school_id == branch.school_id)))
    if any(o.subject_id not in valid for o in data.subjects):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "One of those subjects isn't in this school")
    wanted = [(o.subject_id, o.compulsory) for o in data.subjects]
    set_offering(db, cls, wanted)
    for other_id in data.also_class_ids:
        other = db.get(SchoolClass, other_id)
        if other and other.branch_id == branch.id and other.id != cls.id:
            set_offering(db, other, wanted)
    db.commit()
    return teaching_view(db, branch)


class SlotIn(BaseModel):
    teacher_user_id: uuid.UUID | None = None
    compulsory: bool | None = None


@router.put("/class-subjects/{slot_id}", response_model=TeachingOut)
def update_slot(slot_id: uuid.UUID, data: SlotIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    slot = db.get(ClassSubject, slot_id)
    if not slot:
        raise not_found("Subject")
    cls = db.get(SchoolClass, slot.class_id)
    from app.api.electives import leads_subject, runs_school
    branch = db.get(Branch, cls.branch_id)
    if not runs_school(user, branch):
        if not leads_subject(db, user, db.get(Subject, slot.subject_id)):
            raise not_found("Class")
        # Heads of department or unit may choose the teacher, nothing else.
        data = SlotIn(teacher_user_id=data.teacher_user_id) if "teacher_user_id" in data.model_fields_set else SlotIn()
        if "teacher_user_id" not in data.model_fields_set:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Heads can only choose the teacher")
    if "teacher_user_id" in data.model_fields_set:
        check_teacher(db, branch, data.teacher_user_id)
        slot.teacher_user_id = data.teacher_user_id
    if data.compulsory is not None:
        slot.compulsory = data.compulsory
    db.commit()
    return teaching_view(db, branch)


class StandardIn(BaseModel):
    class_ids: list[uuid.UUID] | None = None  # None: every class that has no subjects yet


@router.post("/branches/{branch_id}/teaching/standard", response_model=TeachingOut)
def apply_standard(branch_id: uuid.UUID, data: StandardIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Gives classes the usual subjects for their stage, from the subjects this school has."""
    branch = owned_branch(db, user, branch_id)
    by_name = {s.name.lower(): s.id for s in db.scalars(select(Subject).where(Subject.school_id == branch.school_id))}
    if not by_name:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Add subjects first, on the Departments and subjects page")
    classes = list(db.scalars(select(SchoolClass).where(SchoolClass.branch_id == branch.id)))
    have = set(db.scalars(select(ClassSubject.class_id).where(ClassSubject.class_id.in_([c.id for c in classes])))) if classes else set()
    for c in classes:
        if (data.class_ids is None and c.id not in have) or (data.class_ids and c.id in data.class_ids):
            set_offering(db, c, [(by_name[n.lower()], comp) for n, comp in standard_for(c.level) if n.lower() in by_name])
    db.commit()
    return teaching_view(db, branch)


# ---------- Helpers for bulk upload ----------

_TITLE = re.compile(r"^(mr|mrs|miss|ms|dr|rev|fr|sr|br|prof|chief|barr|engr)\.?\s+", re.I)


def find_teacher(db: Session, branch: Branch, raw: str) -> User:
    """Finds a staff member by staff number, phone, email or name."""
    from app.core.phone import normalize_phone

    t = raw.strip()
    ids = staff_ids(db, branch.id)
    if not ids:
        raise ValueError("Add staff first")
    p = db.scalar(select(StaffProfile).where(StaffProfile.school_id == branch.school_id,
                                             func.lower(StaffProfile.staff_no) == t.lower()))
    if p and p.user_id in ids:
        return db.get(User, p.user_id)
    phone = normalize_phone(t) if re.fullmatch(r"[\d\s+()-]{7,}", t) else None
    if phone:
        u = db.scalar(select(User).where(User.phone == phone))
        if u and u.id in ids:
            return u
    u = db.scalar(select(User).where(func.lower(User.email) == t.lower()))
    if u and u.id in ids:
        return u
    name = t
    while _TITLE.match(name):
        name = _TITLE.sub("", name, count=1)
    matches = list(db.scalars(select(User).where(User.id.in_(ids), func.lower(User.full_name) == name.lower())))
    if len(matches) == 1:
        return matches[0]
    if len(matches) > 1:
        raise ValueError(f"There are {len(matches)} staff called {name}. Use their staff number or phone instead.")
    raise ValueError(f"No staff member found for '{raw}'. Use their name as on the Staff page, staff number or phone.")
