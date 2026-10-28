"""Organisations (e.g. the Society of Jesus) and how schools sit in them:
create an organisation, edit its profile, move a school to another organisation,
and turn a branch into a school of its own."""
import re
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.api.access import owned_branch, owned_group, owned_school
from app.api.deps import current_user
from app.core.db import get_db
from app.models import (
    Branch, AcademicSession, AssessmentComponent, AssessmentScheme, Board, Facility, GradeBand, GradingScale, Membership,
    Period, Policy, Role, School, SchoolEvent, SchoolGroup, SchoolType, Section, Department, Student, Subject, Term,
    User,
)

router = APIRouter(prefix="/api", tags=["organisations"])


def bad(msg: str) -> HTTPException:
    return HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, msg)


# ---------------- Create and edit organisations ----------------

class NewOrganisation(BaseModel):
    name: str = Field(min_length=2, max_length=200)


class OrganisationProfile(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    name: str = Field(min_length=2, max_length=200)
    logo: str | None = Field(default=None, max_length=600_000)
    description: str | None = Field(default=None, max_length=1000)
    address: str | None = Field(default=None, max_length=500)
    phone: str | None = Field(default=None, max_length=50)
    email: str | None = Field(default=None, max_length=255)
    website: str | None = Field(default=None, max_length=255)

    @field_validator("logo")
    @classmethod
    def check_logo(cls, v: str | None) -> str | None:
        if v and not re.match(r"^data:image/(png|jpeg|webp);base64,", v):
            raise ValueError("The logo must be a PNG, JPG or WebP image")
        return v or None

    @field_validator("email")
    @classmethod
    def check_email(cls, v: str | None) -> str | None:
        if v and not re.match(r"^\S+@\S+\.\S+$", v):
            raise ValueError("That email address doesn't look right")
        return v.lower() if v else None


class OrganisationOut(OrganisationProfile):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID


@router.post("/groups", response_model=OrganisationOut, status_code=201)
def create_organisation(data: NewOrganisation, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Creates a new organisation, with the person creating it as its owner."""
    group = SchoolGroup(name=data.name.strip())
    db.add(group)
    db.flush()
    db.add(Membership(user_id=user.id, role=Role.owner, group_id=group.id))
    db.commit()
    db.refresh(group)
    return group


@router.get("/groups/{group_id}/profile", response_model=OrganisationOut)
def get_organisation(group_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return owned_group(db, user, group_id)


@router.put("/groups/{group_id}/profile", response_model=OrganisationOut)
def save_organisation(group_id: uuid.UUID, data: OrganisationProfile,
                      user: User = Depends(current_user), db: Session = Depends(get_db)):
    group = owned_group(db, user, group_id)
    for k, v in data.model_dump().items():
        setattr(group, k, v if v != "" else None)
    db.commit()
    db.refresh(group)
    return group


# ---------------- Move a school to another organisation ----------------

class MoveSchool(BaseModel):
    group_id: uuid.UUID


@router.post("/schools/{school_id}/move", status_code=204)
def move_school(school_id: uuid.UUID, data: MoveSchool, user: User = Depends(current_user), db: Session = Depends(get_db)):
    school = owned_school(db, user, school_id)
    owned_group(db, user, data.group_id)
    if school.group_id == data.group_id:
        return
    # Everyone working at, studying at or governing this school moves with it.
    db.execute(update(Membership).where(Membership.school_id == school.id).values(group_id=data.group_id))
    db.execute(update(Board).where(Board.school_id == school.id).values(group_id=data.group_id))
    school.group_id = data.group_id
    db.commit()


# ---------------- Turn a branch into its own school ----------------

class MakeSchool(BaseModel):
    name: str = Field(min_length=2, max_length=200)
    school_type: SchoolType | None = None
    copy_setup: bool = True


class MadeSchool(BaseModel):
    school_id: uuid.UUID
    copied: list[str]


def _copy_setup(db: Session, src: School, dst: School) -> list[str]:
    """Copies the old school's set-up into the new one. People (heads, patrons) are not copied:
    the new school appoints its own."""
    copied: list[str] = []

    scale_map: dict[uuid.UUID, uuid.UUID] = {}
    for sc in db.scalars(select(GradingScale).where(GradingScale.school_id == src.id)):
        new = GradingScale(school_id=dst.id, name=sc.name, bands=[
            GradeBand(grade=b.grade, min_score=b.min_score, max_score=b.max_score, remark=b.remark) for b in sc.bands])
        db.add(new)
        db.flush()
        scale_map[sc.id] = new.id
    scheme_map: dict[uuid.UUID, uuid.UUID] = {}
    for sc in db.scalars(select(AssessmentScheme).where(AssessmentScheme.school_id == src.id)):
        new = AssessmentScheme(school_id=dst.id, name=sc.name, components=[
            AssessmentComponent(name=c.name, max_score=c.max_score, position=c.position, parts=list(c.parts or []))
            for c in sc.components])
        db.add(new)
        db.flush()
        scheme_map[sc.id] = new.id
    if scale_map or scheme_map:
        copied.append("grading and CA / exam split")

    section_map: dict[uuid.UUID, uuid.UUID] = {}
    for s in db.scalars(select(Section).where(Section.school_id == src.id)):
        new = Section(school_id=dst.id, name=s.name, position=s.position, levels=list(s.levels or []),
                      grading_scale_id=scale_map.get(s.grading_scale_id), assessment_scheme_id=scheme_map.get(s.assessment_scheme_id))
        db.add(new)
        db.flush()
        section_map[s.id] = new.id
    if section_map:
        copied.append("sections")

    dept_map: dict[uuid.UUID, uuid.UUID] = {}
    for d in db.scalars(select(Department).where(Department.school_id == src.id)):
        new = Department(school_id=dst.id, name=d.name, kind=d.kind, description=d.description)
        db.add(new)
        db.flush()
        dept_map[d.id] = new.id
    if dept_map:
        copied.append("departments")

    subjects = list(db.scalars(select(Subject).where(Subject.school_id == src.id)))
    db.add_all(Subject(school_id=dst.id, name=s.name, code=s.code, department_id=dept_map.get(s.department_id)) for s in subjects)
    if subjects:
        copied.append("subjects")

    periods = list(db.scalars(select(Period).where(Period.school_id == src.id)))
    db.add_all(Period(school_id=dst.id, name=p.name, kind=p.kind, starts_at=p.starts_at, ends_at=p.ends_at,
                      section_id=section_map.get(p.section_id) if p.section_id else None) for p in periods)
    if periods:
        copied.append("bell times")

    policies = list(db.scalars(select(Policy).where(Policy.school_id == src.id)))
    db.add_all(Policy(school_id=dst.id, title=p.title, category=p.category, body=p.body) for p in policies)
    if policies:
        copied.append("rules and policies")

    sessions = list(db.scalars(select(AcademicSession).where(AcademicSession.school_id == src.id)))
    for se in sessions:
        db.add(AcademicSession(school_id=dst.id, name=se.name, terms=[
            Term(number=t.number, name=t.name, starts_on=t.starts_on, ends_on=t.ends_on, is_current=t.is_current)
            for t in se.terms]))
    if sessions:
        copied.append("sessions and terms")

    events = list(db.scalars(select(SchoolEvent).where(SchoolEvent.school_id == src.id, SchoolEvent.branch_id.is_(None))))
    db.add_all(SchoolEvent(school_id=dst.id, title=e.title, category=e.category, starts_on=e.starts_on,
                           ends_on=e.ends_on, description=e.description) for e in events)
    if events:
        copied.append("calendar dates")
    return copied


def _guess_type(old: SchoolType, has_boarding: bool) -> SchoolType:
    if not has_boarding:
        return SchoolType.day
    return SchoolType.boarding if old == SchoolType.boarding else SchoolType.mixed


def split_branch(db: Session, branch: "Branch", name: str, school_type: SchoolType | None, copy_setup: bool) -> tuple[School, list[str]]:
    """Turns a branch into a school of its own in the same organisation, keeping its students,
    staff, classes, attendance, facilities, hostels and vehicles. Does not commit."""
    old = branch.school
    new = School(
        group_id=old.group_id, name=name.strip(),
        school_type=school_type or _guess_type(old.school_type, branch.has_boarding),
        address=branch.address, phone=branch.phone, email=branch.email, state=old.state,
    )
    db.add(new)
    db.flush()
    copied = _copy_setup(db, old, new) if copy_setup else []
    db.execute(update(Student).where(Student.branch_id == branch.id).values(school_id=new.id))
    db.execute(update(Membership).where(Membership.branch_id == branch.id).values(school_id=new.id))
    db.execute(update(SchoolEvent).where(SchoolEvent.branch_id == branch.id).values(school_id=new.id, branch_id=None))
    new_depts = {d.name.lower(): d.id for d in db.scalars(select(Department).where(Department.school_id == new.id))}
    for f in db.scalars(select(Facility).where(Facility.branch_id == branch.id)):
        if f.department_id:
            old_dept = db.get(Department, f.department_id)
            f.department_id = new_depts.get(old_dept.name.lower()) if old_dept else None
    branch.school_id = new.id
    branch.name = new.name
    db.flush()
    return new, copied


@router.post("/branches/{branch_id}/make-school", response_model=MadeSchool, status_code=201)
def make_branch_a_school(branch_id: uuid.UUID, data: MakeSchool,
                         user: User = Depends(current_user), db: Session = Depends(get_db)):
    branch = owned_branch(db, user, branch_id)
    if len(branch.school.branches) == 1:
        raise bad(f"{branch.name} is the only branch of {branch.school.name}, so it's already a school on its own")
    new, copied = split_branch(db, branch, data.name, data.school_type, data.copy_setup)
    db.commit()
    return MadeSchool(school_id=new.id, copied=copied)


# ---------------- Removing ----------------

class ConfirmName(BaseModel):
    confirm_name: str


@router.api_route("/schools/{school_id}", methods=["DELETE"], status_code=204)
def delete_school(school_id: uuid.UUID, data: ConfirmName, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Permanently removes a school with all its campuses, students, attendance and set-up.
    The exact school name must be typed to confirm. People's logins are kept."""
    school = owned_school(db, user, school_id)
    if data.confirm_name.strip().lower() != school.name.strip().lower():
        raise bad("The name you typed doesn't match the school's name")
    db.delete(school)
    db.commit()


@router.delete("/groups/{group_id}", status_code=204)
def delete_organisation(group_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Removes an organisation. It must have no schools left (move or remove them first)."""
    group = owned_group(db, user, group_id)
    if group.schools:
        raise bad(f"{group.name} still has {len(group.schools)} school(s). Move or remove them first.")
    if len(owned_group_ids_for(user)) <= 1:
        raise bad("You can't remove your only organisation")
    db.delete(group)
    db.commit()


def owned_group_ids_for(user: User) -> set[uuid.UUID]:
    return {m.group_id for m in user.memberships if m.role == Role.owner}
