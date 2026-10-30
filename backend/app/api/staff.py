import uuid
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.access import not_found, owned_branch
from app.api.deps import current_user
from app.api.people import find_or_create_user
from app.core.db import get_db
from app.models import Branch, Department, EmploymentType, Gender, Membership, Role, StaffProfile, Unit, User

router = APIRouter(prefix="/api", tags=["staff"])

STAFF_ROLES = [Role.head, Role.vice_principal, Role.it_admin, Role.bursar, Role.teacher, Role.house_parent, Role.support]

# Positions most Nigerian secondary schools fill. Shown on the Staff page as "key positions".
KEY_POSITIONS = [
    "Principal", "Vice Principal (Academics)", "Vice Principal (Administration)", "Chaplain", "Bursar",
    "Dean of Studies", "Examinations Officer", "Registrar", "Guidance Counsellor", "Boarding Master",
    "Boarding Mistress", "Librarian", "School Nurse", "Sports Master", "ICT Officer", "Head of Security",
]
JOB_TITLES = KEY_POSITIONS + [
    "Head of Department", "Subject Teacher", "Class Teacher", "Laboratory Technician", "Matron", "House Master",
    "House Mistress", "Accountant", "Admin Officer", "Secretary", "Store Keeper", "Cook", "Driver", "Security Officer",
    "Cleaner", "Gardener", "Electrician", "Plumber", "Carpenter",
]


class ProfileIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    staff_no: str | None = Field(default=None, max_length=40)
    title: str | None = Field(default=None, max_length=30)
    gender: Gender | None = None
    job_title: str | None = Field(default=None, max_length=100)
    department_id: uuid.UUID | None = None
    unit_id: uuid.UUID | None = None
    teaching: bool = True
    employment_type: EmploymentType = EmploymentType.full_time
    date_joined: date | None = None
    qualification: str | None = Field(default=None, max_length=100)


class StaffIn(ProfileIn):
    full_name: str = Field(min_length=2, max_length=200)
    phone: str | None = None
    email: str | None = None
    role: Role


class StaffUpdate(ProfileIn):
    full_name: str = Field(min_length=2, max_length=200)


class StaffRoleOut(BaseModel):
    membership_id: uuid.UUID
    role: Role


class StaffOut(BaseModel):
    user_id: uuid.UUID
    full_name: str
    phone: str | None
    email: str | None
    roles: list[StaffRoleOut]
    staff_no: str | None = None
    title: str | None = None
    gender: Gender | None = None
    job_title: str | None = None
    department_id: uuid.UUID | None = None
    department_name: str | None = None
    unit_id: uuid.UUID | None = None
    unit_name: str | None = None
    teaching: bool = True
    employment_type: EmploymentType = EmploymentType.full_time
    date_joined: date | None = None
    qualification: str | None = None
    heads_departments: list[str] = []
    heads_units: list[str] = []


class StaffCreated(BaseModel):
    staff: list[StaffOut]
    new_login: dict | None


def staff_list(db: Session, branch_id: uuid.UUID) -> list[StaffOut]:
    branch = db.get(Branch, branch_id)
    rows = db.scalars(
        select(Membership).where(Membership.branch_id == branch_id, Membership.role.in_(STAFF_ROLES))
    ).all()
    profiles = {p.user_id: p for p in db.scalars(select(StaffProfile).where(StaffProfile.school_id == branch.school_id))}
    heads: dict[uuid.UUID, list[str]] = {}
    for d in db.scalars(select(Department).where(Department.school_id == branch.school_id, Department.head_user_id.is_not(None))):
        heads.setdefault(d.head_user_id, []).append(d.name)
    unit_heads: dict[uuid.UUID, list[str]] = {}
    for u in db.scalars(select(Unit).where(Unit.school_id == branch.school_id, Unit.head_user_id.is_not(None))):
        unit_heads.setdefault(u.head_user_id, []).append(u.name)
    people: dict[uuid.UUID, StaffOut] = {}
    for m in rows:
        u = m.user
        if u.id not in people:
            p = profiles.get(u.id)
            extra = {}
            if p:
                extra = dict(
                    staff_no=p.staff_no, title=p.title, gender=p.gender, job_title=p.job_title,
                    department_id=p.department_id, department_name=p.department.name if p.department else None,
                    unit_id=p.unit_id, unit_name=p.unit.name if p.unit else None,
                    teaching=p.teaching, employment_type=p.employment_type, date_joined=p.date_joined,
                    qualification=p.qualification,
                )
            people[u.id] = StaffOut(user_id=u.id, full_name=u.full_name, phone=u.phone, email=u.email, roles=[],
                                    heads_departments=sorted(heads.get(u.id, [])),
                                    heads_units=sorted(unit_heads.get(u.id, [])), **extra)
        people[u.id].roles.append(StaffRoleOut(membership_id=m.id, role=m.role))
    for p in people.values():
        p.roles.sort(key=lambda r: STAFF_ROLES.index(r.role))
    return sorted(people.values(), key=lambda p: p.full_name.lower())


def save_profile(db: Session, school_id: uuid.UUID, user_id: uuid.UUID, data: ProfileIn, only_given: bool = False) -> StaffProfile:
    """Creates or updates a person's staff record at a school."""
    if data.department_id:
        dept = db.get(Department, data.department_id)
        if not dept or dept.school_id != school_id:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "That department isn't in this school")
    if data.unit_id:
        unit = db.get(Unit, data.unit_id)
        if not unit or unit.school_id != school_id:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "That unit isn't in this school")
        if not data.department_id:
            data = data.model_copy(update={"department_id": unit.department_id})
    p = db.scalar(select(StaffProfile).where(StaffProfile.school_id == school_id, StaffProfile.user_id == user_id))
    if not p:
        p = StaffProfile(school_id=school_id, user_id=user_id)
        db.add(p)
    fields = data.model_dump(exclude_unset=only_given)
    for k in ProfileIn.model_fields:
        if k in fields and not (only_given and fields[k] in (None, "")):
            setattr(p, k, fields[k] if fields[k] != "" else None)
    db.flush()
    return p


def add_staff_role(db: Session, branch: Branch, person: User, role: Role) -> bool:
    """Gives a person a staff role at a branch. Returns False if they already had it."""
    exists = db.scalar(select(Membership).where(
        Membership.user_id == person.id, Membership.branch_id == branch.id, Membership.role == role))
    if exists:
        return False
    db.add(Membership(user_id=person.id, role=role, group_id=branch.school.group_id,
                      school_id=branch.school_id, branch_id=branch.id))
    return True


@router.get("/staff-options")
def staff_options() -> dict:
    return {"key_positions": KEY_POSITIONS, "job_titles": JOB_TITLES}


@router.get("/branches/{branch_id}/staff", response_model=list[StaffOut])
def list_staff(branch_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    owned_branch(db, user, branch_id)
    return staff_list(db, branch_id)


@router.post("/branches/{branch_id}/staff", response_model=StaffCreated, status_code=201)
def add_staff(branch_id: uuid.UUID, data: StaffIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    branch = owned_branch(db, user, branch_id)
    if data.role not in STAFF_ROLES:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Choose a staff role")
    person, password = find_or_create_user(db, data.full_name, data.phone, data.email)
    if not add_staff_role(db, branch, person, data.role):
        raise HTTPException(status.HTTP_409_CONFLICT, f"{person.full_name} already has that role here")
    save_profile(db, branch.school_id, person.id, data, only_given=True)
    db.commit()
    new_login = {"name": person.full_name, "username": person.phone or person.email, "password": password} if password else None
    return StaffCreated(staff=staff_list(db, branch_id), new_login=new_login)


@router.put("/branches/{branch_id}/staff/{user_id}", response_model=list[StaffOut])
def update_staff(branch_id: uuid.UUID, user_id: uuid.UUID, data: StaffUpdate,
                 user: User = Depends(current_user), db: Session = Depends(get_db)):
    branch = owned_branch(db, user, branch_id)
    if not any(s.user_id == user_id for s in staff_list(db, branch_id)):
        raise not_found("Staff member")
    person = db.get(User, user_id)
    person.full_name = data.full_name
    save_profile(db, branch.school_id, user_id, data)
    db.commit()
    return staff_list(db, branch_id)


@router.delete("/staff-roles/{membership_id}", status_code=204)
def remove_staff_role(membership_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    m = db.get(Membership, membership_id)
    if not m or m.role not in STAFF_ROLES or not m.branch_id:
        raise not_found("Staff role")
    owned_branch(db, user, m.branch_id)
    db.delete(m)
    db.commit()
    return Response(status_code=204)
