import uuid
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.api.access import not_found, owned_branch
from app.api.deps import current_user
from app.api.people import find_or_create_user
from app.core.db import get_db
from app.models import (
    BoardingStatus, Branch, Gender, Membership, Role, SchoolClass, Student, StudentGuardian, StudentStatus, User,
)

router = APIRouter(prefix="/api", tags=["students"])


def _clean(v: str | None) -> str | None:
    v = (v or "").strip()
    return v or None


class GuardianIn(BaseModel):
    full_name: str = Field(min_length=2, max_length=200)
    relationship: str = Field(default="Parent", max_length=30)
    phone: str | None = None
    email: str | None = None


class StudentBase(BaseModel):
    first_name: str = Field(min_length=1, max_length=80)
    middle_name: str | None = Field(default=None, max_length=80)
    last_name: str = Field(min_length=1, max_length=80)
    gender: Gender
    date_of_birth: date | None = None
    state_of_origin: str | None = Field(default=None, max_length=50)
    class_id: uuid.UUID | None = None
    boarding_status: BoardingStatus = BoardingStatus.day

    @field_validator("date_of_birth")
    @classmethod
    def not_future(cls, v: date | None) -> date | None:
        if v and v > date.today():
            raise ValueError("Date of birth can't be in the future")
        return v


class StudentCreate(StudentBase):
    admission_no: str | None = Field(default=None, max_length=40)
    guardian: GuardianIn | None = None


class StudentUpdate(StudentBase):
    admission_no: str = Field(min_length=1, max_length=40)
    status: StudentStatus = StudentStatus.active


class SiblingOut(BaseModel):
    id: uuid.UUID
    full_name: str
    branch_name: str
    class_name: str | None


class GuardianOut(BaseModel):
    link_id: uuid.UUID
    user_id: uuid.UUID
    full_name: str
    relationship: str
    phone: str | None
    email: str | None
    other_children: list[SiblingOut]


class StudentRow(BaseModel):
    id: uuid.UUID
    admission_no: str
    full_name: str
    first_name: str
    middle_name: str | None
    last_name: str
    gender: Gender
    date_of_birth: date | None
    state_of_origin: str | None
    class_id: uuid.UUID | None
    class_name: str | None
    boarding_status: BoardingStatus
    status: StudentStatus


class StudentDetail(StudentRow):
    branch_id: uuid.UUID
    guardians: list[GuardianOut]


class StudentCreated(BaseModel):
    student: StudentDetail
    new_login: dict | None  # {"name", "username", "password"} shown once


def _row(s: Student) -> StudentRow:
    return StudentRow(
        id=s.id, admission_no=s.admission_no, full_name=s.full_name, first_name=s.first_name,
        middle_name=s.middle_name, last_name=s.last_name, gender=s.gender, date_of_birth=s.date_of_birth,
        state_of_origin=s.state_of_origin, class_id=s.class_id,
        class_name=s.school_class.name if s.school_class else None,
        boarding_status=s.boarding_status, status=s.status,
    )


def _detail(db: Session, s: Student) -> StudentDetail:
    guardians = []
    for link in sorted(s.guardians, key=lambda g: g.created_at):
        others = db.scalars(
            select(Student)
            .join(StudentGuardian, StudentGuardian.student_id == Student.id)
            .where(StudentGuardian.user_id == link.user_id, Student.id != s.id)
            .order_by(Student.first_name)
        )
        guardians.append(
            GuardianOut(
                link_id=link.id, user_id=link.user_id, full_name=link.user.full_name,
                relationship=link.relationship_label, phone=link.user.phone, email=link.user.email,
                other_children=[
                    SiblingOut(
                        id=o.id, full_name=o.full_name, branch_name=db.get(Branch, o.branch_id).name,
                        class_name=o.school_class.name if o.school_class else None,
                    )
                    for o in others
                ],
            )
        )
    return StudentDetail(**_row(s).model_dump(), branch_id=s.branch_id, guardians=guardians)


def _owned_student(db: Session, user: User, student_id: uuid.UUID) -> Student:
    s = db.get(Student, student_id)
    if not s:
        raise not_found("Student")
    owned_branch(db, user, s.branch_id)
    return s


def _check_class(db: Session, branch_id: uuid.UUID, class_id: uuid.UUID | None) -> None:
    if class_id is None:
        return
    cls = db.get(SchoolClass, class_id)
    if not cls or cls.branch_id != branch_id:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "That class isn't at this branch")


def _check_admission_no(db: Session, school_id: uuid.UUID, number: str, exclude: uuid.UUID | None = None) -> None:
    q = select(Student).where(Student.school_id == school_id, func.lower(Student.admission_no) == number.lower())
    if exclude:
        q = q.where(Student.id != exclude)
    if db.scalar(q):
        raise HTTPException(status.HTTP_409_CONFLICT, f"Admission number {number} is already used in this school")


def _next_admission_no(db: Session, school_id: uuid.UUID) -> str:
    year = date.today().year
    count = db.scalar(select(func.count()).where(Student.school_id == school_id)) or 0
    while True:
        count += 1
        candidate = f"ADM/{year}/{count:04d}"
        if not db.scalar(select(Student.id).where(Student.school_id == school_id, Student.admission_no == candidate)):
            return candidate


def _link_guardian(db: Session, student: Student, branch: Branch, g: GuardianIn) -> dict | None:
    parent, password = find_or_create_user(db, g.full_name, g.phone, g.email)
    if any(link.user_id == parent.id for link in student.guardians):
        raise HTTPException(status.HTTP_409_CONFLICT, f"{parent.full_name} is already linked to this student")
    student.guardians.append(
        StudentGuardian(user_id=parent.id, relationship_label=(g.relationship or "Parent").strip() or "Parent")
    )
    has_parent_role = db.scalar(
        select(Membership).where(
            Membership.user_id == parent.id, Membership.role == Role.parent, Membership.branch_id == branch.id
        )
    )
    if not has_parent_role:
        db.add(
            Membership(
                user_id=parent.id, role=Role.parent, group_id=branch.school.group_id,
                school_id=branch.school_id, branch_id=branch.id,
            )
        )
    if password:
        return {"name": parent.full_name, "username": parent.phone or parent.email, "password": password}
    return None


@router.get("/branches/{branch_id}/students", response_model=list[StudentRow])
def list_students(
    branch_id: uuid.UUID,
    q: str | None = None,
    class_id: uuid.UUID | None = None,
    include_inactive: bool = False,
    limit: int = Query(500, le=2000),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    owned_branch(db, user, branch_id)
    stmt = select(Student).where(Student.branch_id == branch_id)
    if not include_inactive:
        stmt = stmt.where(Student.status == StudentStatus.active)
    if class_id:
        stmt = stmt.where(Student.class_id == class_id)
    if q and q.strip():
        like = f"%{q.strip()}%"
        stmt = stmt.where(
            or_(
                Student.first_name.ilike(like), Student.last_name.ilike(like),
                Student.middle_name.ilike(like), Student.admission_no.ilike(like),
            )
        )
    stmt = stmt.order_by(Student.last_name, Student.first_name).limit(limit)
    return [_row(s) for s in db.scalars(stmt).unique()]


@router.post("/branches/{branch_id}/students", response_model=StudentCreated, status_code=201)
def add_student(
    branch_id: uuid.UUID, data: StudentCreate, user: User = Depends(current_user), db: Session = Depends(get_db)
):
    branch = owned_branch(db, user, branch_id)
    _check_class(db, branch_id, data.class_id)
    if data.boarding_status == BoardingStatus.boarder and not branch.has_boarding:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "This branch doesn't have boarding")
    number = _clean(data.admission_no)
    if number:
        _check_admission_no(db, branch.school_id, number)
    else:
        number = _next_admission_no(db, branch.school_id)

    student = Student(
        school_id=branch.school_id, branch_id=branch_id, class_id=data.class_id, admission_no=number,
        first_name=data.first_name.strip(), middle_name=_clean(data.middle_name), last_name=data.last_name.strip(),
        gender=data.gender, date_of_birth=data.date_of_birth, state_of_origin=_clean(data.state_of_origin),
        boarding_status=data.boarding_status,
    )
    db.add(student)
    new_login = _link_guardian(db, student, branch, data.guardian) if data.guardian else None
    db.commit()
    db.refresh(student)
    return StudentCreated(student=_detail(db, student), new_login=new_login)


@router.get("/students/{student_id}", response_model=StudentDetail)
def get_student(student_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return _detail(db, _owned_student(db, user, student_id))


@router.patch("/students/{student_id}", response_model=StudentDetail)
def update_student(
    student_id: uuid.UUID, data: StudentUpdate, user: User = Depends(current_user), db: Session = Depends(get_db)
):
    s = _owned_student(db, user, student_id)
    branch = db.get(Branch, s.branch_id)
    _check_class(db, s.branch_id, data.class_id)
    if data.boarding_status == BoardingStatus.boarder and not branch.has_boarding:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "This branch doesn't have boarding")
    number = data.admission_no.strip()
    _check_admission_no(db, s.school_id, number, exclude=s.id)
    s.admission_no = number
    s.first_name, s.middle_name, s.last_name = data.first_name.strip(), _clean(data.middle_name), data.last_name.strip()
    s.gender, s.date_of_birth, s.state_of_origin = data.gender, data.date_of_birth, _clean(data.state_of_origin)
    s.class_id, s.boarding_status, s.status = data.class_id, data.boarding_status, data.status
    db.commit()
    db.refresh(s)
    return _detail(db, s)


@router.post("/students/{student_id}/guardians", response_model=StudentCreated, status_code=201)
def add_guardian(
    student_id: uuid.UUID, data: GuardianIn, user: User = Depends(current_user), db: Session = Depends(get_db)
):
    s = _owned_student(db, user, student_id)
    new_login = _link_guardian(db, s, db.get(Branch, s.branch_id), data)
    db.commit()
    db.refresh(s)
    return StudentCreated(student=_detail(db, s), new_login=new_login)


@router.delete("/students/{student_id}/guardians/{link_id}", status_code=204)
def remove_guardian(
    student_id: uuid.UUID, link_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)
):
    s = _owned_student(db, user, student_id)
    link = next((g for g in s.guardians if g.id == link_id), None)
    if not link:
        raise not_found("Guardian")
    s.guardians.remove(link)
    db.commit()
    return Response(status_code=204)
