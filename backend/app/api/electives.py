"""SS electives. A level (SS 1, say) offers elective subjects. Each elective is taught in one or more
groups, each with one teacher; students from any arm of the level join one group per subject.

Who may put students in groups: the people who run the school (principal, vice principals, IT team,
owner), the head of the subject's department, the head of its unit, and a group's own teacher for
their group. Students choosing for themselves comes with the student portal.
"""
import uuid

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.access import not_found
from app.api.deps import current_user, managed_school_ids, owned_group_ids
from app.api.teaching import check_teacher
from app.core.db import get_db
from app.models import (
    Branch, ClassSubject, Department, SchoolClass, StaffProfile, Student, StudentElective, StudentStatus, Subject,
    TeachingGroup, Unit, User,
)

router = APIRouter(prefix="/api", tags=["electives"])


def is_senior(level: str) -> bool:
    return level.upper().startswith("SS")


# ---------- Who may do what ----------

def runs_school(user: User, branch: Branch) -> bool:
    return branch.school.group_id in owned_group_ids(user) or branch.school_id in managed_school_ids(user)


def leads_subject(db: Session, user: User, subject: Subject) -> bool:
    """Head of the subject's department or of its unit."""
    if subject.department_id:
        d = db.get(Department, subject.department_id)
        if d and d.head_user_id == user.id:
            return True
    if subject.unit_id:
        u = db.get(Unit, subject.unit_id)
        if u and u.head_user_id == user.id:
            return True
    return False


def branch_for(db: Session, user: User, branch_id: uuid.UUID) -> Branch:
    """The branch, if the user works there in any role that can see electives."""
    b = db.get(Branch, branch_id)
    if not b:
        raise not_found("School")
    if runs_school(user, b) or any(m.branch_id == b.id or m.school_id == b.school_id for m in user.memberships):
        return b
    raise not_found("School")


def may_manage_subject(db: Session, user: User, branch: Branch, subject: Subject) -> bool:
    return runs_school(user, branch) or leads_subject(db, user, subject)


def may_manage_group(db: Session, user: User, branch: Branch, group: TeachingGroup) -> bool:
    return group.teacher_user_id == user.id or may_manage_subject(db, user, branch, db.get(Subject, group.subject_id))


def forbid(what: str = "You can't change this"):
    raise HTTPException(status.HTTP_403_FORBIDDEN, what)


# ---------- Reading ----------

class GroupOut(BaseModel):
    id: uuid.UUID
    level: str
    subject_id: uuid.UUID
    name: str
    teacher_user_id: uuid.UUID | None
    teacher_name: str | None
    capacity: int | None
    count: int
    can_manage: bool


class ElectiveSubject(BaseModel):
    id: uuid.UUID
    name: str
    taking: int
    without_group: int
    can_manage: bool


class StudentChoice(BaseModel):
    id: uuid.UUID
    name: str
    admission_no: str
    class_name: str | None
    gender: str
    choices: dict[str, str | None]  # subject id -> group id (None: taking it, no group yet)


class LevelView(BaseModel):
    levels: list[str]
    level: str | None
    subjects: list[ElectiveSubject]
    groups: list[GroupOut]
    students: list[StudentChoice]


def senior_levels(db: Session, branch: Branch) -> list[str]:
    levels = db.scalars(select(SchoolClass.level).where(SchoolClass.branch_id == branch.id)
                        .group_by(SchoolClass.level).order_by(func.min(SchoolClass.level_order), SchoolClass.level))
    return [l for l in levels if is_senior(l)]


def electives_for(db: Session, branch: Branch, level: str) -> list[Subject]:
    """Subjects marked as electives in any class of this level."""
    ids = set(db.scalars(select(ClassSubject.subject_id).join(SchoolClass, SchoolClass.id == ClassSubject.class_id).where(
        SchoolClass.branch_id == branch.id, SchoolClass.level == level, ClassSubject.compulsory.is_(False))))
    return sorted((db.get(Subject, i) for i in ids), key=lambda s: s.name.lower())


def teacher_name(db: Session, school_id: uuid.UUID, user_id: uuid.UUID | None) -> str | None:
    if not user_id:
        return None
    u = db.get(User, user_id)
    p = db.scalar(select(StaffProfile).where(StaffProfile.school_id == school_id, StaffProfile.user_id == user_id))
    return " ".join(x for x in [p.title if p else None, u.full_name if u else None] if x) or None


def level_view(db: Session, user: User, branch: Branch, level: str | None) -> LevelView:
    levels = senior_levels(db, branch)
    if level not in levels:
        level = levels[0] if levels else None
    if not level:
        return LevelView(levels=[], level=None, subjects=[], groups=[], students=[])
    subjects = electives_for(db, branch, level)
    students = list(db.scalars(select(Student).join(SchoolClass, SchoolClass.id == Student.class_id).where(
        Student.branch_id == branch.id, Student.status == StudentStatus.active, SchoolClass.level == level)
        .order_by(Student.last_name, Student.first_name)).unique())
    sids = [s.id for s in students]
    rows = list(db.scalars(select(StudentElective).where(StudentElective.student_id.in_(sids)))) if sids else []
    groups = list(db.scalars(select(TeachingGroup).where(TeachingGroup.branch_id == branch.id, TeachingGroup.level == level)
                             .order_by(TeachingGroup.name)))
    count = {g.id: 0 for g in groups}
    by_student: dict = {}
    for r in rows:
        by_student.setdefault(r.student_id, {})[str(r.subject_id)] = str(r.group_id) if r.group_id else None
        if r.group_id in count:
            count[r.group_id] += 1
    runs = runs_school(user, branch)
    subj_out = []
    for s in subjects:
        taking = [r for r in rows if r.subject_id == s.id]
        subj_out.append(ElectiveSubject(id=s.id, name=s.name, taking=len(taking),
                                        without_group=sum(1 for r in taking if not r.group_id),
                                        can_manage=runs or leads_subject(db, user, s)))
    managed = {s.id for s in subj_out if s.can_manage}
    return LevelView(
        levels=levels, level=level, subjects=subj_out,
        groups=[GroupOut(id=g.id, level=g.level, subject_id=g.subject_id, name=g.name, teacher_user_id=g.teacher_user_id,
                         teacher_name=teacher_name(db, branch.school_id, g.teacher_user_id), capacity=g.capacity,
                         count=count[g.id], can_manage=g.subject_id in managed or g.teacher_user_id == user.id)
                for g in groups],
        students=[StudentChoice(id=s.id, name=f"{s.last_name}, {s.first_name}", admission_no=s.admission_no,
                                class_name=s.school_class.name if s.school_class else None, gender=s.gender.value,
                                choices=by_student.get(s.id, {})) for s in students],
    )


@router.get("/branches/{branch_id}/electives", response_model=LevelView)
def get_electives(branch_id: uuid.UUID, level: str | None = None, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return level_view(db, user, branch_for(db, user, branch_id), level)


# ---------- Groups ----------

class GroupIn(BaseModel):
    level: str
    subject_id: uuid.UUID
    teacher_user_id: uuid.UUID | None = None
    name: str | None = Field(default=None, max_length=100)
    capacity: int | None = Field(default=None, ge=1, le=500)


def make_group(db: Session, branch: Branch, level: str, subject: Subject, teacher_id: uuid.UUID | None,
               name: str | None = None, capacity: int | None = None) -> TeachingGroup:
    if not is_senior(level):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Elective groups are for SS classes")
    check_teacher(db, branch, teacher_id)
    if not name:
        n = db.scalar(select(func.count()).where(TeachingGroup.branch_id == branch.id, TeachingGroup.level == level,
                                                 TeachingGroup.subject_id == subject.id)) or 0
        who = teacher_name(db, branch.school_id, teacher_id)
        name = f"{level} {subject.name}: " + (who if who else f"Group {chr(65 + n)}")
        taken = set(db.scalars(select(TeachingGroup.name).where(TeachingGroup.branch_id == branch.id, TeachingGroup.level == level,
                                                               TeachingGroup.subject_id == subject.id)))
        base, k = name, 2
        while name in taken:
            name, k = f"{base} ({k})", k + 1
    g = TeachingGroup(branch_id=branch.id, level=level, subject_id=subject.id, teacher_user_id=teacher_id, name=name[:100],
                      capacity=capacity)
    db.add(g)
    db.flush()
    return g


@router.post("/branches/{branch_id}/groups", response_model=LevelView, status_code=201)
def add_group(branch_id: uuid.UUID, data: GroupIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    b = branch_for(db, user, branch_id)
    subject = db.get(Subject, data.subject_id)
    if not subject or subject.school_id != b.school_id:
        raise not_found("Subject")
    if not may_manage_subject(db, user, b, subject):
        forbid("Only the principal, vice principals, IT team or the subject's HOD or unit head can add groups")
    make_group(db, b, data.level, subject, data.teacher_user_id, data.name, data.capacity)
    db.commit()
    return level_view(db, user, b, data.level)


class GroupUpdate(BaseModel):
    teacher_user_id: uuid.UUID | None = None
    name: str | None = Field(default=None, max_length=100)
    capacity: int | None = Field(default=None, ge=1, le=500)


def _own_group(db: Session, user: User, group_id: uuid.UUID) -> tuple[TeachingGroup, Branch]:
    g = db.get(TeachingGroup, group_id)
    if not g:
        raise not_found("Group")
    return g, branch_for(db, user, g.branch_id)


@router.patch("/groups/{group_id}", response_model=LevelView)
def update_group(group_id: uuid.UUID, data: GroupUpdate, user: User = Depends(current_user), db: Session = Depends(get_db)):
    g, b = _own_group(db, user, group_id)
    if not may_manage_subject(db, user, b, db.get(Subject, g.subject_id)):
        forbid()
    if "teacher_user_id" in data.model_fields_set:
        check_teacher(db, b, data.teacher_user_id)
        g.teacher_user_id = data.teacher_user_id
    if data.name:
        g.name = data.name
    if "capacity" in data.model_fields_set:
        g.capacity = data.capacity
    db.commit()
    return level_view(db, user, b, g.level)


@router.delete("/groups/{group_id}", status_code=204)
def delete_group(group_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    g, b = _own_group(db, user, group_id)
    if not may_manage_subject(db, user, b, db.get(Subject, g.subject_id)):
        forbid()
    db.delete(g)  # students keep the subject, just without a group
    db.commit()
    return Response(status_code=204)


# ---------- Students' choices ----------

def set_choice(db: Session, student: Student, subject: Subject, group: TeachingGroup | None, taking: bool) -> None:
    level = student.school_class.level if student.school_class else None
    if not level or not is_senior(level):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"{student.full_name} isn't in an SS class")
    row = db.scalar(select(StudentElective).where(StudentElective.student_id == student.id, StudentElective.subject_id == subject.id))
    if not taking:
        if row:
            db.delete(row)
        return
    if group:
        if group.subject_id != subject.id or group.level != level or group.branch_id != student.branch_id:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"That group isn't {level} {subject.name}")
        if group.capacity and (not row or row.group_id != group.id):
            n = db.scalar(select(func.count()).where(StudentElective.group_id == group.id)) or 0
            if n >= group.capacity:
                raise HTTPException(status.HTTP_409_CONFLICT, f"{group.name} is full ({group.capacity})")
    if not row:
        row = StudentElective(student_id=student.id, subject_id=subject.id)
        db.add(row)
    row.group_id = group.id if group else None
    db.flush()


class ChoiceIn(BaseModel):
    taking: bool = True
    group_id: uuid.UUID | None = None


@router.put("/students/{student_id}/electives/{subject_id}", response_model=LevelView)
def put_choice(student_id: uuid.UUID, subject_id: uuid.UUID, data: ChoiceIn,
               user: User = Depends(current_user), db: Session = Depends(get_db)):
    student = db.get(Student, student_id)
    if not student:
        raise not_found("Student")
    b = branch_for(db, user, student.branch_id)
    subject = db.get(Subject, subject_id)
    if not subject or subject.school_id != b.school_id:
        raise not_found("Subject")
    group = db.get(TeachingGroup, data.group_id) if data.group_id else None
    if not may_manage_subject(db, user, b, subject):
        # A teacher may add to, or take out of, their own group only.
        current = db.scalar(select(StudentElective).where(StudentElective.student_id == student.id,
                                                          StudentElective.subject_id == subject.id))
        if group and current and current.group_id and current.group_id != group.id:
            forbid("This student already has another teacher for this subject")
        own = (group and group.teacher_user_id == user.id) or (
            not data.taking and current and current.group_id and db.get(TeachingGroup, current.group_id).teacher_user_id == user.id)
        if not own:
            forbid()
    set_choice(db, student, subject, group, data.taking)
    db.commit()
    return level_view(db, user, b, student.school_class.level)


class SpreadIn(BaseModel):
    level: str
    subject_id: uuid.UUID


@router.post("/branches/{branch_id}/electives/spread", response_model=LevelView)
def spread(branch_id: uuid.UUID, data: SpreadIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Shares students taking a subject but not yet in a group evenly across its groups."""
    b = branch_for(db, user, branch_id)
    subject = db.get(Subject, data.subject_id)
    if not subject or not may_manage_subject(db, user, b, subject):
        forbid()
    groups = list(db.scalars(select(TeachingGroup).where(TeachingGroup.branch_id == b.id, TeachingGroup.level == data.level,
                                                         TeachingGroup.subject_id == subject.id)))
    if not groups:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Add a group (with its teacher) first")
    rows = list(db.scalars(select(StudentElective).join(Student).join(SchoolClass, SchoolClass.id == Student.class_id).where(
        StudentElective.subject_id == subject.id, SchoolClass.level == data.level, Student.branch_id == b.id)))
    size = {g.id: sum(1 for r in rows if r.group_id == g.id) for g in groups}
    for r in [r for r in rows if not r.group_id]:
        open_groups = [g for g in groups if not g.capacity or size[g.id] < g.capacity]
        if not open_groups:
            break
        g = min(open_groups, key=lambda x: size[x.id])
        r.group_id = g.id
        size[g.id] += 1
    db.commit()
    return level_view(db, user, b, data.level)


# ---------- One student's subjects (for the student's page) ----------

class SubjectLine(BaseModel):
    subject_id: uuid.UUID
    name: str
    compulsory: bool
    teacher_name: str | None
    group_id: uuid.UUID | None = None
    group_name: str | None = None


class StudentSubjects(BaseModel):
    senior: bool
    level: str | None
    subjects: list[SubjectLine]
    available: list[dict]   # electives not taken yet, with their groups


@router.get("/students/{student_id}/subjects", response_model=StudentSubjects)
def student_subjects(student_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    s = db.get(Student, student_id)
    if not s:
        raise not_found("Student")
    b = branch_for(db, user, s.branch_id)
    cls = s.school_class
    if not cls:
        return StudentSubjects(senior=False, level=None, subjects=[], available=[])
    slots = list(db.scalars(select(ClassSubject).where(ClassSubject.class_id == cls.id)))
    senior = is_senior(cls.level)
    lines = []
    taken = {r.subject_id: r for r in db.scalars(select(StudentElective).where(StudentElective.student_id == s.id))}
    for slot in slots:
        subj = db.get(Subject, slot.subject_id)
        if slot.compulsory or not senior:
            lines.append(SubjectLine(subject_id=subj.id, name=subj.name, compulsory=True,
                                     teacher_name=teacher_name(db, b.school_id, slot.teacher_user_id)))
    groups = list(db.scalars(select(TeachingGroup).where(TeachingGroup.branch_id == b.id, TeachingGroup.level == cls.level)))
    available = []
    if senior:
        for subj in electives_for(db, b, cls.level):
            row = taken.get(subj.id)
            mine = [g for g in groups if g.subject_id == subj.id]
            if row:
                g = next((x for x in mine if x.id == row.group_id), None)
                lines.append(SubjectLine(subject_id=subj.id, name=subj.name, compulsory=False,
                                         teacher_name=teacher_name(db, b.school_id, g.teacher_user_id) if g else None,
                                         group_id=g.id if g else None, group_name=g.name if g else None))
            available.append({"subject_id": str(subj.id), "name": subj.name, "taking": bool(row),
                              "groups": [{"id": str(g.id), "name": g.name,
                                          "teacher_name": teacher_name(db, b.school_id, g.teacher_user_id)} for g in mine]})
    lines.sort(key=lambda x: (not x.compulsory, x.name.lower()))
    return StudentSubjects(senior=senior, level=cls.level, subjects=lines, available=available)
