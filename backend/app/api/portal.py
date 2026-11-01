"""The staff portal: what a staff member sees when they log in."""
import uuid
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.access import not_found
from app.api.deps import MANAGER_ROLES, current_user, owned_group_ids
from app.api.electives import may_manage_group, runs_school
from app.api.staff import STAFF_ROLES
from app.core.db import get_db
from app.models import (
    AttendanceKind, AttendanceRecord, AttendanceStatus, BoardingStatus, Branch, ClassSubject, Department, Membership, Role,
    SchoolClass, SchoolEvent, StaffProfile, Student, StudentElective, StudentStatus, Subject, TeachingGroup, Unit, User,
)

router = APIRouter(prefix="/api", tags=["staff portal"])


class Today(BaseModel):
    total: int
    marked: int
    present: int
    absent: int


class FormClass(BaseModel):
    id: uuid.UUID
    name: str
    students: int
    boys: int
    girls: int
    today: Today


class Teach(BaseModel):
    slot_id: uuid.UUID
    class_id: uuid.UUID
    class_name: str
    subject_name: str
    students: int


class Group(BaseModel):
    id: uuid.UUID
    subject_id: uuid.UUID
    name: str
    level: str
    subject_name: str
    count: int
    capacity: int | None


class Gap(BaseModel):
    slot_id: uuid.UUID
    class_name: str
    subject_name: str
    department_name: str | None


class Person(BaseModel):
    user_id: uuid.UUID
    name: str
    job_title: str | None
    unit_name: str | None = None


class Leads(BaseModel):
    kind: str          # department or unit
    id: uuid.UUID
    name: str
    teaching: bool
    staff: list[Person]
    subjects: list[str]
    gaps: list[Gap]
    classes_covered: int


class Team(BaseModel):
    kind: str
    name: str
    head: str | None
    people: list[Person]


class Event(BaseModel):
    title: str
    starts_on: date
    ends_on: date | None
    category: str


class SchoolHome(BaseModel):
    school_id: uuid.UUID
    school_name: str
    motto: str | None
    logo: str | None
    colour: str | None
    school_type: str
    branch_id: uuid.UUID
    has_boarding: bool
    roles: list[Role]
    runs_school: bool
    title: str | None
    job_title: str | None
    department_name: str | None
    unit_name: str | None
    form_classes: list[FormClass]
    teaches: list[Teach]
    groups: list[Group]
    night_roll: Today | None
    leads: list[Leads]
    events: list[Event]
    teachers: list[Person]   # for heads choosing teachers
    teaching: bool
    team: Team | None
    duties: list[dict] = []       # my duties in the next fortnight
    to_review: int = 0            # lesson notes waiting for me to review
    leave_waiting: int = 0        # leave requests waiting for a decision (for the people who run the school)
    notes_returned: int = 0       # my lesson notes sent back for changes


class Home(BaseModel):
    full_name: str
    owner: bool
    schools: list[SchoolHome]


def _today(db: Session, students: list[uuid.UUID], kind: AttendanceKind, day: date) -> Today:
    if not students:
        return Today(total=0, marked=0, present=0, absent=0)
    rows = list(db.scalars(select(AttendanceRecord.status).where(
        AttendanceRecord.student_id.in_(students), AttendanceRecord.kind == kind, AttendanceRecord.on_date == day)))
    return Today(total=len(students), marked=len(rows),
                 present=sum(1 for r in rows if r in (AttendanceStatus.present, AttendanceStatus.late)),
                 absent=sum(1 for r in rows if r == AttendanceStatus.absent))


def _class_size(db: Session, class_id: uuid.UUID) -> int:
    return db.scalar(select(func.count()).where(Student.class_id == class_id, Student.status == StudentStatus.active)) or 0


def school_home(db: Session, user: User, branch: Branch, day: date) -> SchoolHome:
    school = branch.school
    roles = sorted({m.role for m in user.memberships if m.branch_id == branch.id or (m.school_id == school.id and m.role != Role.parent)},
                   key=lambda r: r.value)
    profile = db.scalar(select(StaffProfile).where(StaffProfile.school_id == school.id, StaffProfile.user_id == user.id))
    profiles = {p.user_id: p for p in db.scalars(select(StaffProfile).where(StaffProfile.school_id == school.id))}

    # My classes as class teacher
    forms = []
    for c in db.scalars(select(SchoolClass).where(SchoolClass.branch_id == branch.id, SchoolClass.form_teacher_id == user.id)
                        .order_by(SchoolClass.level_order, SchoolClass.arm)):
        kids = list(db.scalars(select(Student).where(Student.class_id == c.id, Student.status == StudentStatus.active)).unique())
        forms.append(FormClass(id=c.id, name=c.name, students=len(kids),
                               boys=sum(1 for k in kids if k.gender.value == "male"), girls=sum(1 for k in kids if k.gender.value == "female"),
                               today=_today(db, [k.id for k in kids], AttendanceKind.school, day)))

    # What I teach (class subjects) and my elective groups
    teaches = []
    for slot in db.scalars(select(ClassSubject).join(SchoolClass, SchoolClass.id == ClassSubject.class_id).where(
            SchoolClass.branch_id == branch.id, ClassSubject.teacher_user_id == user.id)
            .order_by(SchoolClass.level_order, SchoolClass.arm)):
        c, s = db.get(SchoolClass, slot.class_id), db.get(Subject, slot.subject_id)
        if c.level.upper().startswith("SS") and not slot.compulsory:
            continue  # SS electives are taught in groups
        teaches.append(Teach(slot_id=slot.id, class_id=c.id, class_name=c.name, subject_name=s.name, students=_class_size(db, c.id)))
    groups = []
    for g in db.scalars(select(TeachingGroup).where(TeachingGroup.branch_id == branch.id, TeachingGroup.teacher_user_id == user.id)
                        .order_by(TeachingGroup.level, TeachingGroup.name)):
        n = db.scalar(select(func.count()).where(StudentElective.group_id == g.id)) or 0
        groups.append(Group(id=g.id, subject_id=g.subject_id, name=g.name, level=g.level, subject_name=db.get(Subject, g.subject_id).name, count=n, capacity=g.capacity))

    night = None
    if Role.house_parent in roles and branch.has_boarding:
        boarders = list(db.scalars(select(Student.id).where(Student.branch_id == branch.id, Student.status == StudentStatus.active,
                                                            Student.boarding_status == BoardingStatus.boarder)))
        night = _today(db, boarders, AttendanceKind.night, day)

    # Departments and units I lead
    def person(uid: uuid.UUID) -> Person:
        u, p = db.get(User, uid), profiles.get(uid)
        return Person(user_id=uid, name=" ".join(x for x in [p.title if p else None, u.full_name] if x),
                      job_title=p.job_title if p else None, unit_name=p.unit.name if p and p.unit else None)

    def subject_gaps(subject_ids: set) -> tuple[list[Gap], int]:
        if not subject_ids:
            return [], 0
        rows = list(db.scalars(select(ClassSubject).join(SchoolClass, SchoolClass.id == ClassSubject.class_id).where(
            SchoolClass.branch_id == branch.id, ClassSubject.subject_id.in_(subject_ids))))
        gaps = []
        for r in rows:
            c, s = db.get(SchoolClass, r.class_id), db.get(Subject, r.subject_id)
            if c.level.upper().startswith("SS") and not r.compulsory:
                continue
            if not r.teacher_user_id:
                d = db.get(Department, s.department_id) if s.department_id else None
                gaps.append(Gap(slot_id=r.id, class_name=c.name, subject_name=s.name, department_name=d.name if d else None))
        return sorted(gaps, key=lambda g: (g.subject_name, g.class_name)), len(rows) - len(gaps)

    leads = []
    for d in db.scalars(select(Department).where(Department.school_id == school.id, Department.head_user_id == user.id)):
        subs = list(db.scalars(select(Subject).where(Subject.department_id == d.id).order_by(Subject.name)))
        gaps, covered = subject_gaps({s.id for s in subs})
        staff = [person(p.user_id) for p in profiles.values() if p.department_id == d.id]
        leads.append(Leads(kind="department", id=d.id, name=d.name, teaching=d.kind.value == "academic",
                           staff=sorted(staff, key=lambda x: x.name), subjects=[s.name for s in subs], gaps=gaps, classes_covered=covered))
    for u in db.scalars(select(Unit).where(Unit.school_id == school.id, Unit.head_user_id == user.id)):
        subs = list(db.scalars(select(Subject).where(Subject.unit_id == u.id).order_by(Subject.name)))
        gaps, covered = subject_gaps({s.id for s in subs})
        staff = [person(p.user_id) for p in profiles.values() if p.unit_id == u.id]
        leads.append(Leads(kind="unit", id=u.id, name=u.name, teaching=u.teaching, staff=sorted(staff, key=lambda x: x.name),
                           subjects=[s.name for s in subs], gaps=gaps, classes_covered=covered))

    teachers = []
    if leads:
        ids = set(db.scalars(select(Membership.user_id).where(Membership.branch_id == branch.id, Membership.role.in_(STAFF_ROLES))))
        teachers = sorted((person(i) for i in ids if not profiles.get(i) or profiles[i].teaching), key=lambda x: x.name)

    team = None
    led = {l.id for l in leads}
    if profile and profile.unit_id and profile.unit_id not in led:
        u = db.get(Unit, profile.unit_id)
        team = Team(kind="unit", name=u.name, head=person(u.head_user_id).name if u.head_user_id else None,
                    people=sorted((person(p.user_id) for p in profiles.values() if p.unit_id == u.id and p.user_id != user.id), key=lambda x: x.name))
    elif profile and profile.department_id and profile.department_id not in led:
        d = db.get(Department, profile.department_id)
        team = Team(kind="department", name=d.name, head=person(d.head_user_id).name if d.head_user_id else None,
                    people=sorted((person(p.user_id) for p in profiles.values() if p.department_id == d.id and p.user_id != user.id), key=lambda x: x.name)[:40])

    events = [Event(title=e.title, starts_on=e.starts_on, ends_on=e.ends_on, category=e.category.value) for e in db.scalars(
        select(SchoolEvent).where(SchoolEvent.school_id == school.id,
                                  func.coalesce(SchoolEvent.ends_on, SchoolEvent.starts_on) >= day)
        .order_by(SchoolEvent.starts_on).limit(5))]

    return SchoolHome(
        school_id=school.id, school_name=school.name, motto=school.motto, logo=school.logo, colour=school.colour,
        school_type=school.school_type.value, branch_id=branch.id, has_boarding=branch.has_boarding, roles=roles,
        runs_school=runs_school(user, branch), title=profile.title if profile else None,
        job_title=profile.job_title if profile else None,
        department_name=profile.department.name if profile and profile.department else None,
        unit_name=profile.unit.name if profile and profile.unit else None,
        form_classes=forms, teaches=teaches, groups=groups, night_roll=night, leads=leads, events=events, teachers=teachers,
        teaching=bool(forms or teaches or groups) or (profile.teaching if profile else Role.teacher in roles),
        team=team, **_day_bits(db, user, school),
    )


def _day_bits(db: Session, user: User, school) -> dict:
    from datetime import timedelta
    from app.api.staff_day import list_notes, now_wat, runs
    from app.models import DutyAssignment, LeaveRequest, LessonNote
    today = now_wat().date()
    duties = [{"duty": d.duty, "on_date": d.on_date.isoformat(), "note": d.note} for d in db.scalars(
        select(DutyAssignment).where(DutyAssignment.school_id == school.id, DutyAssignment.user_id == user.id,
                                     DutyAssignment.on_date >= today, DutyAssignment.on_date <= today + timedelta(days=14))
        .order_by(DutyAssignment.on_date).limit(12))]
    review = sum(1 for n in list_notes(school.id, "review", "submitted", user, db))
    leave = len(list(db.scalars(select(LeaveRequest.id).where(LeaveRequest.school_id == school.id, LeaveRequest.status == "pending",
                                                              LeaveRequest.user_id != user.id)))) if runs(user, school) else 0
    returned = len(list(db.scalars(select(LessonNote.id).where(LessonNote.school_id == school.id, LessonNote.user_id == user.id,
                                                               LessonNote.status == "returned"))))
    return {"duties": duties, "to_review": review, "leave_waiting": leave, "notes_returned": returned}


@router.get("/me/home", response_model=Home)
def my_home(on_date: date | None = Query(default=None, alias="date"), user: User = Depends(current_user), db: Session = Depends(get_db)):
    day = on_date or date.today()
    branch_ids = []
    for m in user.memberships:
        if m.role in STAFF_ROLES or m.role in MANAGER_ROLES:
            b = m.branch_id
            if not b and m.school_id:
                b = db.scalar(select(Branch.id).where(Branch.school_id == m.school_id).order_by(Branch.created_at))
            if b and b not in branch_ids:
                branch_ids.append(b)
    return Home(full_name=user.full_name, owner=bool(owned_group_ids(user)),
                schools=[school_home(db, user, db.get(Branch, b), day) for b in branch_ids])


# ---------- Lists for the staff portal ----------

class Pupil(BaseModel):
    id: uuid.UUID
    name: str
    admission_no: str
    class_name: str | None
    gender: str
    boarder: bool
    in_group: bool = False


def _pupil(s: Student, in_group: bool = False) -> Pupil:
    return Pupil(id=s.id, name=f"{s.last_name}, {s.first_name}", admission_no=s.admission_no,
                 class_name=s.school_class.name if s.school_class else None, gender=s.gender.value,
                 boarder=s.boarding_status == BoardingStatus.boarder, in_group=in_group)


@router.get("/me/classes/{class_id}/students", response_model=list[Pupil])
def class_list(class_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """A class list, for its class teacher, anyone who teaches it, or the people who run the school."""
    c = db.get(SchoolClass, class_id)
    if not c:
        raise not_found("Class")
    branch = db.get(Branch, c.branch_id)
    teaches = db.scalar(select(ClassSubject.id).where(ClassSubject.class_id == c.id, ClassSubject.teacher_user_id == user.id))
    if not (c.form_teacher_id == user.id or teaches or runs_school(user, branch, "students")):
        raise not_found("Class")
    return [_pupil(s) for s in db.scalars(select(Student).where(Student.class_id == c.id, Student.status == StudentStatus.active)
                                          .order_by(Student.last_name, Student.first_name)).unique()]


class GroupList(BaseModel):
    group: Group
    can_manage: bool
    members: list[Pupil]
    others: list[Pupil]   # students of the level who could join (taking the subject without a group, or not taking it)


@router.get("/me/groups/{group_id}", response_model=GroupList)
def group_list(group_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    g = db.get(TeachingGroup, group_id)
    if not g:
        raise not_found("Group")
    branch = db.get(Branch, g.branch_id)
    if not may_manage_group(db, user, branch, g):
        raise not_found("Group")
    rows = {r.student_id: r for r in db.scalars(select(StudentElective).where(StudentElective.subject_id == g.subject_id))}
    level_students = list(db.scalars(select(Student).join(SchoolClass, SchoolClass.id == Student.class_id).where(
        Student.branch_id == branch.id, Student.status == StudentStatus.active, SchoolClass.level == g.level)
        .order_by(Student.last_name, Student.first_name)).unique())
    members = [_pupil(s, True) for s in level_students if s.id in rows and rows[s.id].group_id == g.id]
    others = [_pupil(s, s.id in rows and rows[s.id].group_id is not None) for s in level_students
              if not (s.id in rows and rows[s.id].group_id == g.id)]
    n = len(members)
    return GroupList(group=Group(id=g.id, subject_id=g.subject_id, name=g.name, level=g.level, subject_name=db.get(Subject, g.subject_id).name, count=n,
                                 capacity=g.capacity), can_manage=True, members=members, others=others)
