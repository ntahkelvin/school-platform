import uuid

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.access import not_found, owned_branch
from app.api.deps import current_user
from app.api.people import find_or_create_user
from app.core.db import get_db
from app.models import Membership, Role, User

router = APIRouter(prefix="/api", tags=["staff"])

STAFF_ROLES = [Role.head, Role.bursar, Role.teacher, Role.house_parent]


class StaffIn(BaseModel):
    full_name: str = Field(min_length=2, max_length=200)
    phone: str | None = None
    email: str | None = None
    role: Role


class StaffRoleOut(BaseModel):
    membership_id: uuid.UUID
    role: Role


class StaffOut(BaseModel):
    user_id: uuid.UUID
    full_name: str
    phone: str | None
    email: str | None
    roles: list[StaffRoleOut]


class StaffCreated(BaseModel):
    staff: list[StaffOut]
    new_login: dict | None


def staff_list(db: Session, branch_id: uuid.UUID) -> list[StaffOut]:
    rows = db.scalars(
        select(Membership).where(Membership.branch_id == branch_id, Membership.role.in_(STAFF_ROLES))
    ).all()
    people: dict[uuid.UUID, StaffOut] = {}
    for m in rows:
        u = m.user
        entry = people.setdefault(u.id, StaffOut(user_id=u.id, full_name=u.full_name, phone=u.phone, email=u.email, roles=[]))
        entry.roles.append(StaffRoleOut(membership_id=m.id, role=m.role))
    for p in people.values():
        p.roles.sort(key=lambda r: STAFF_ROLES.index(r.role))
    return sorted(people.values(), key=lambda p: p.full_name.lower())


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
    exists = db.scalar(
        select(Membership).where(
            Membership.user_id == person.id, Membership.branch_id == branch_id, Membership.role == data.role
        )
    )
    if exists:
        raise HTTPException(status.HTTP_409_CONFLICT, f"{person.full_name} already has that role here")
    db.add(
        Membership(
            user_id=person.id, role=data.role, group_id=branch.school.group_id,
            school_id=branch.school_id, branch_id=branch_id,
        )
    )
    db.commit()
    new_login = {"name": person.full_name, "username": person.phone or person.email, "password": password} if password else None
    return StaffCreated(staff=staff_list(db, branch_id), new_login=new_login)


@router.delete("/staff-roles/{membership_id}", status_code=204)
def remove_staff_role(membership_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    m = db.get(Membership, membership_id)
    if not m or m.role not in STAFF_ROLES or not m.branch_id:
        raise not_found("Staff role")
    owned_branch(db, user, m.branch_id)
    db.delete(m)
    db.commit()
    return Response(status_code=204)
