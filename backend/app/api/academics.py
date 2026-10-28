"""Sessions and terms, subjects, and classes."""
import re
import uuid
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, Field, field_validator, model_validator
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.access import not_found, owned_branch, owned_school
from app.api.deps import current_user
from app.core.db import get_db
from app.models import AcademicSession, SchoolClass, Student, StudentStatus, Subject, Term, User

router = APIRouter(prefix="/api", tags=["academics"])

TERM_NAMES = {1: "First term", 2: "Second term", 3: "Third term"}

# The order classes are listed and promoted in. Anything not listed sorts after these.
LEVELS = [
    "Creche", "Pre-Nursery", "Nursery 1", "Nursery 2", "Nursery 3", "KG 1", "KG 2",
    "Primary 1", "Primary 2", "Primary 3", "Primary 4", "Primary 5", "Primary 6",
    "JSS 1", "JSS 2", "JSS 3", "SS 1", "SS 2", "SS 3",
]

COMMON_SUBJECTS = [
    "English Language", "Mathematics", "Basic Science", "Basic Technology", "Social Studies",
    "Civic Education", "Christian Religious Studies", "Islamic Religious Studies",
    "Agricultural Science", "Home Economics", "Business Studies", "Computer Studies",
    "Cultural and Creative Arts", "Physical and Health Education", "French", "Igbo", "Yoruba", "Hausa",
    "Physics", "Chemistry", "Biology", "Further Mathematics", "Economics", "Government",
    "Literature in English", "Geography", "Financial Accounting", "Commerce", "Technical Drawing",
]


# ---------- Sessions and terms ----------

class TermOut(BaseModel):
    id: uuid.UUID
    number: int
    name: str
    starts_on: date | None
    ends_on: date | None
    is_current: bool
    model_config = {"from_attributes": True}


class SessionOut(BaseModel):
    id: uuid.UUID
    name: str
    terms: list[TermOut]
    model_config = {"from_attributes": True}


class SessionIn(BaseModel):
    name: str

    @field_validator("name")
    @classmethod
    def check_name(cls, v: str) -> str:
        v = v.strip().replace(" ", "")
        m = re.fullmatch(r"(\d{4})/(\d{4})", v)
        if not m or int(m.group(2)) != int(m.group(1)) + 1:
            raise ValueError("Use the format 2026/2027")
        return v


class TermIn(BaseModel):
    starts_on: date | None = None
    ends_on: date | None = None

    @model_validator(mode="after")
    def check_dates(self) -> "TermIn":
        if self.starts_on and self.ends_on and self.ends_on < self.starts_on:
            raise ValueError("The term can't end before it starts")
        return self


def _sessions(db: Session, school_id: uuid.UUID) -> list[AcademicSession]:
    return list(
        db.scalars(
            select(AcademicSession).where(AcademicSession.school_id == school_id).order_by(AcademicSession.name.desc())
        )
    )


def _owned_term(db: Session, user: User, term_id: uuid.UUID) -> Term:
    term = db.get(Term, term_id)
    if not term:
        raise not_found("Term")
    owned_school(db, user, term.session.school_id)
    return term


@router.get("/schools/{school_id}/sessions", response_model=list[SessionOut])
def list_sessions(school_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    owned_school(db, user, school_id)
    return _sessions(db, school_id)


@router.post("/schools/{school_id}/sessions", response_model=SessionOut, status_code=201)
def add_session(
    school_id: uuid.UUID, data: SessionIn, user: User = Depends(current_user), db: Session = Depends(get_db)
):
    """Creates a session with its three terms."""
    owned_school(db, user, school_id)
    if db.scalar(select(AcademicSession).where(AcademicSession.school_id == school_id, AcademicSession.name == data.name)):
        raise HTTPException(status.HTTP_409_CONFLICT, f"Session {data.name} already exists")
    session = AcademicSession(school_id=school_id, name=data.name)
    session.terms = [Term(number=n, name=name, is_current=False) for n, name in TERM_NAMES.items()]
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


@router.patch("/terms/{term_id}", response_model=TermOut)
def update_term(term_id: uuid.UUID, data: TermIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    term = _owned_term(db, user, term_id)
    term.starts_on, term.ends_on = data.starts_on, data.ends_on
    db.commit()
    db.refresh(term)
    return term


@router.post("/terms/{term_id}/make-current", response_model=list[SessionOut])
def make_current(term_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Marks this the school's current term (and un-marks every other term)."""
    term = _owned_term(db, user, term_id)
    school_id = term.session.school_id
    for s in _sessions(db, school_id):
        for t in s.terms:
            t.is_current = t.id == term.id
    db.commit()
    return _sessions(db, school_id)


# ---------- Subjects ----------

class SubjectIn(BaseModel):
    name: str = Field(min_length=2, max_length=100)
    code: str | None = Field(default=None, max_length=20)


class SubjectOut(SubjectIn):
    id: uuid.UUID
    model_config = {"from_attributes": True}


def _subjects(db: Session, school_id: uuid.UUID) -> list[Subject]:
    return list(db.scalars(select(Subject).where(Subject.school_id == school_id).order_by(Subject.name)))


@router.get("/schools/{school_id}/subjects", response_model=list[SubjectOut])
def list_subjects(school_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    owned_school(db, user, school_id)
    return _subjects(db, school_id)


@router.post("/schools/{school_id}/subjects", response_model=SubjectOut, status_code=201)
def add_subject(
    school_id: uuid.UUID, data: SubjectIn, user: User = Depends(current_user), db: Session = Depends(get_db)
):
    owned_school(db, user, school_id)
    name = data.name.strip()
    existing = {s.name.lower() for s in _subjects(db, school_id)}
    if name.lower() in existing:
        raise HTTPException(status.HTTP_409_CONFLICT, f"{name} is already a subject")
    subject = Subject(school_id=school_id, name=name, code=(data.code or "").strip().upper() or None)
    db.add(subject)
    db.commit()
    db.refresh(subject)
    return subject


@router.post("/schools/{school_id}/subjects/add-common", response_model=list[SubjectOut])
def add_common_subjects(school_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Adds the usual Nigerian primary and secondary subjects, skipping any already there."""
    owned_school(db, user, school_id)
    existing = {s.name.lower() for s in _subjects(db, school_id)}
    db.add_all(Subject(school_id=school_id, name=n) for n in COMMON_SUBJECTS if n.lower() not in existing)
    db.commit()
    return _subjects(db, school_id)


@router.delete("/subjects/{subject_id}", status_code=204)
def delete_subject(subject_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    subject = db.get(Subject, subject_id)
    if not subject:
        raise not_found("Subject")
    owned_school(db, user, subject.school_id)
    db.delete(subject)
    db.commit()
    return Response(status_code=204)


# ---------- Classes ----------

class ClassIn(BaseModel):
    level: str = Field(min_length=1, max_length=30)
    arm: str = Field(default="", max_length=20)


class ClassOut(BaseModel):
    id: uuid.UUID
    level: str
    arm: str
    name: str
    student_count: int


@router.get("/levels", response_model=list[str])
def levels() -> list[str]:
    return LEVELS


def _level_order(level: str) -> int:
    try:
        return LEVELS.index(level)
    except ValueError:
        return len(LEVELS)


def class_list(db: Session, branch_id: uuid.UUID) -> list[ClassOut]:
    counts = dict(
        db.execute(
            select(Student.class_id, func.count())
            .where(Student.branch_id == branch_id, Student.status == StudentStatus.active)
            .group_by(Student.class_id)
        ).all()
    )
    classes = db.scalars(
        select(SchoolClass)
        .where(SchoolClass.branch_id == branch_id)
        .order_by(SchoolClass.level_order, SchoolClass.level, SchoolClass.arm)
    )
    return [ClassOut(id=c.id, level=c.level, arm=c.arm, name=c.name, student_count=counts.get(c.id, 0)) for c in classes]


@router.get("/branches/{branch_id}/classes", response_model=list[ClassOut])
def list_classes(branch_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    owned_branch(db, user, branch_id)
    return class_list(db, branch_id)


@router.post("/branches/{branch_id}/classes", response_model=list[ClassOut], status_code=201)
def add_class(branch_id: uuid.UUID, data: ClassIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    owned_branch(db, user, branch_id)
    level, arm = data.level.strip(), data.arm.strip().upper() if len(data.arm.strip()) <= 2 else data.arm.strip()
    clash = db.scalar(
        select(SchoolClass).where(SchoolClass.branch_id == branch_id, SchoolClass.level == level, SchoolClass.arm == arm)
    )
    if clash:
        raise HTTPException(status.HTTP_409_CONFLICT, f"{clash.name} already exists at this branch")
    db.add(SchoolClass(branch_id=branch_id, level=level, arm=arm, level_order=_level_order(level)))
    db.commit()
    return class_list(db, branch_id)


@router.delete("/classes/{class_id}", status_code=204)
def delete_class(class_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    cls = db.get(SchoolClass, class_id)
    if not cls:
        raise not_found("Class")
    owned_branch(db, user, cls.branch_id)
    if db.scalar(select(func.count()).where(Student.class_id == cls.id, Student.status == StudentStatus.active)):
        raise HTTPException(status.HTTP_409_CONFLICT, "Move the students out of this class before deleting it")
    db.delete(cls)
    db.commit()
    return Response(status_code=204)
