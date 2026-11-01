import uuid
from collections import Counter
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.access import not_found, owned_branch
from app.api.deps import managed_school_ids, owned_group_ids
from app.models import Membership, Role
from app.api.deps import current_user
from app.core.db import get_db
from app.models import (
    AttendanceKind, AttendanceRecord, AttendanceStatus, BoardingStatus, SchoolClass, Student, StudentStatus, User,
)

router = APIRouter(prefix="/api", tags=["attendance"])


def _check_date(d: date) -> None:
    # Allow a day of slack for time-zone differences between phone and server.
    if d > date.today() + timedelta(days=1):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "You can't take a register for a future date")


class RegisterStudent(BaseModel):
    id: uuid.UUID
    full_name: str
    admission_no: str
    class_name: str | None
    status: AttendanceStatus | None
    note: str | None


class Register(BaseModel):
    kind: AttendanceKind
    on_date: date
    title: str
    branch_id: uuid.UUID
    class_id: uuid.UUID | None
    students: list[RegisterStudent]
    last_saved_at: datetime | None


class Entry(BaseModel):
    student_id: uuid.UUID
    status: AttendanceStatus
    note: str | None = Field(default=None, max_length=200)


class RegisterSave(BaseModel):
    on_date: date
    entries: list[Entry]


def _build(db: Session, kind: AttendanceKind, on_date: date, title: str, branch_id: uuid.UUID,
           class_id: uuid.UUID | None, students: list[Student]) -> Register:
    ids = [s.id for s in students]
    records = {
        r.student_id: r
        for r in db.scalars(
            select(AttendanceRecord).where(
                AttendanceRecord.student_id.in_(ids), AttendanceRecord.on_date == on_date, AttendanceRecord.kind == kind
            )
        )
    } if ids else {}
    return Register(
        kind=kind, on_date=on_date, title=title, branch_id=branch_id, class_id=class_id,
        students=[
            RegisterStudent(
                id=s.id, full_name=f"{s.last_name}, {s.first_name}", admission_no=s.admission_no,
                class_name=s.school_class.name if s.school_class else None,
                status=records[s.id].status if s.id in records else None,
                note=records[s.id].note if s.id in records else None,
            )
            for s in students
        ],
        last_saved_at=max((r.recorded_at for r in records.values()), default=None),
    )


def _save(db: Session, user: User, kind: AttendanceKind, branch_id: uuid.UUID, allowed: dict[uuid.UUID, Student],
          data: RegisterSave) -> None:
    _check_date(data.on_date)
    unknown = [e.student_id for e in data.entries if e.student_id not in allowed]
    if unknown:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Some students aren't on this register any more. Reload and try again.")
    existing = {
        r.student_id: r
        for r in db.scalars(
            select(AttendanceRecord).where(
                AttendanceRecord.student_id.in_(list(allowed)), AttendanceRecord.on_date == data.on_date,
                AttendanceRecord.kind == kind,
            )
        )
    }
    now = datetime.now(timezone.utc)
    for e in data.entries:
        note = (e.note or "").strip() or None
        rec = existing.get(e.student_id)
        if rec:
            rec.status, rec.note, rec.recorded_by_id, rec.recorded_at = e.status, note, user.id, now
        else:
            db.add(AttendanceRecord(
                student_id=e.student_id, branch_id=branch_id, class_id=allowed[e.student_id].class_id,
                on_date=data.on_date, kind=kind, status=e.status, note=note, recorded_by_id=user.id, recorded_at=now,
            ))
    db.commit()


# ---------- Class register ----------

def _owned_class(db: Session, user: User, class_id: uuid.UUID) -> SchoolClass:
    """The class, if the user runs the school or is the class's own class teacher."""
    cls = db.get(SchoolClass, class_id)
    if not cls:
        raise not_found("Class")
    if cls.form_teacher_id == user.id:
        return cls
    owned_branch(db, user, cls.branch_id)
    return cls


def _night_branch(db: Session, user: User, branch_id: uuid.UUID):
    """Night roll: people who run the school, and house parents there."""
    is_house_parent = db.scalar(select(Membership.id).where(
        Membership.user_id == user.id, Membership.branch_id == branch_id, Membership.role == Role.house_parent))
    if is_house_parent:
        from app.models import Branch
        return db.get(Branch, branch_id)
    return owned_branch(db, user, branch_id)


def _class_students(db: Session, cls: SchoolClass) -> list[Student]:
    return list(db.scalars(
        select(Student)
        .where(Student.class_id == cls.id, Student.status == StudentStatus.active)
        .order_by(Student.last_name, Student.first_name)
    ).unique())


@router.get("/classes/{class_id}/register", response_model=Register)
def get_class_register(class_id: uuid.UUID, on_date: date = Query(alias="date"),
                       user: User = Depends(current_user), db: Session = Depends(get_db)):
    cls = _owned_class(db, user, class_id)
    return _build(db, AttendanceKind.school, on_date, cls.name, cls.branch_id, cls.id, _class_students(db, cls))


@router.put("/classes/{class_id}/register", response_model=Register)
def save_class_register(class_id: uuid.UUID, data: RegisterSave,
                        user: User = Depends(current_user), db: Session = Depends(get_db)):
    cls = _owned_class(db, user, class_id)
    students = _class_students(db, cls)
    _save(db, user, AttendanceKind.school, cls.branch_id, {s.id: s for s in students}, data)
    return _build(db, AttendanceKind.school, data.on_date, cls.name, cls.branch_id, cls.id, students)


# ---------- Night roll call (boarders) ----------

def _boarders(db: Session, branch_id: uuid.UUID) -> list[Student]:
    return list(db.scalars(
        select(Student)
        .where(Student.branch_id == branch_id, Student.status == StudentStatus.active,
               Student.boarding_status == BoardingStatus.boarder)
        .order_by(Student.last_name, Student.first_name)
    ).unique())


@router.get("/branches/{branch_id}/night-roll", response_model=Register)
def get_night_roll(branch_id: uuid.UUID, on_date: date = Query(alias="date"),
                   user: User = Depends(current_user), db: Session = Depends(get_db)):
    branch = _night_branch(db, user, branch_id)
    return _build(db, AttendanceKind.night, on_date, f"Night roll call, {branch.name}", branch.id, None,
                  _boarders(db, branch.id))


@router.put("/branches/{branch_id}/night-roll", response_model=Register)
def save_night_roll(branch_id: uuid.UUID, data: RegisterSave,
                    user: User = Depends(current_user), db: Session = Depends(get_db)):
    branch = _night_branch(db, user, branch_id)
    students = _boarders(db, branch.id)
    _save(db, user, AttendanceKind.night, branch.id, {s.id: s for s in students}, data)
    return _build(db, AttendanceKind.night, data.on_date, f"Night roll call, {branch.name}", branch.id, None, students)


# ---------- Day summary for a branch ----------

class Counts(BaseModel):
    total: int = 0
    marked: int = 0
    present: int = 0
    absent: int = 0
    late: int = 0
    excused: int = 0


class ClassSummary(Counts):
    class_id: uuid.UUID
    class_name: str


class DaySummary(BaseModel):
    on_date: date
    classes: list[ClassSummary]
    school: Counts
    night: Counts | None


def _count(students: list[Student], records: dict[uuid.UUID, AttendanceRecord]) -> Counts:
    c = Counts(total=len(students))
    tally = Counter(records[s.id].status.value for s in students if s.id in records)
    c.marked = sum(tally.values())
    c.present, c.absent, c.late, c.excused = tally["present"], tally["absent"], tally["late"], tally["excused"]
    return c


@router.get("/branches/{branch_id}/attendance", response_model=DaySummary)
def day_summary(branch_id: uuid.UUID, on_date: date = Query(alias="date"),
                user: User = Depends(current_user), db: Session = Depends(get_db)):
    branch = owned_branch(db, user, branch_id)
    students = list(db.scalars(
        select(Student).where(Student.branch_id == branch.id, Student.status == StudentStatus.active)
    ).unique())
    rows = db.scalars(select(AttendanceRecord).where(
        AttendanceRecord.branch_id == branch.id, AttendanceRecord.on_date == on_date))
    school_recs, night_recs = {}, {}
    for r in rows:
        (school_recs if r.kind == AttendanceKind.school else night_recs)[r.student_id] = r

    classes = db.scalars(select(SchoolClass).where(SchoolClass.branch_id == branch.id)
                         .order_by(SchoolClass.level_order, SchoolClass.level, SchoolClass.arm))
    summaries = []
    for cls in classes:
        in_class = [s for s in students if s.class_id == cls.id]
        summaries.append(ClassSummary(class_id=cls.id, class_name=cls.name, **_count(in_class, school_recs).model_dump()))
    boarders = [s for s in students if s.boarding_status == BoardingStatus.boarder]
    return DaySummary(
        on_date=on_date, classes=summaries,
        school=_count([s for s in students if s.class_id], school_recs),
        night=_count(boarders, night_recs) if branch.has_boarding else None,
    )


# ---------- One student's history ----------

class HistoryItem(BaseModel):
    on_date: date
    kind: AttendanceKind
    status: AttendanceStatus
    note: str | None


class StudentAttendance(BaseModel):
    days: int
    school: Counts
    rate: float | None  # % of marked school days present or late (excused days don't count against them)
    not_present: list[HistoryItem]


@router.get("/students/{student_id}/attendance", response_model=StudentAttendance)
def student_attendance(student_id: uuid.UUID, days: int = Query(30, ge=1, le=365),
                       user: User = Depends(current_user), db: Session = Depends(get_db)):
    s = db.get(Student, student_id)
    if not s:
        raise not_found("Student")
    owned_branch(db, user, s.branch_id)
    since = date.today() - timedelta(days=days - 1)
    recs = list(db.scalars(
        select(AttendanceRecord).where(AttendanceRecord.student_id == s.id, AttendanceRecord.on_date >= since)
        .order_by(AttendanceRecord.on_date.desc())
    ))
    school = [r for r in recs if r.kind == AttendanceKind.school]
    tally = Counter(r.status.value for r in school)
    counts = Counts(total=len(school), marked=len(school), present=tally["present"], absent=tally["absent"],
                    late=tally["late"], excused=tally["excused"])
    countable = counts.marked - counts.excused
    rate = round(100 * (counts.present + counts.late) / countable, 1) if countable else None
    return StudentAttendance(
        days=days, school=counts, rate=rate,
        not_present=[HistoryItem(on_date=r.on_date, kind=r.kind, status=r.status, note=r.note)
                     for r in recs if r.status != AttendanceStatus.present][:20],
    )
