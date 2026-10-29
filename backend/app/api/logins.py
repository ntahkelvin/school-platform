"""Logins for one school, for the person who runs it (the owner, acting as IT admin).

Passwords are stored scrambled one way, so nobody can read them, not even here.
What an admin can do is see each person's username and status, reset a forgotten
password (the new one is shown once), and switch a login off or on.
"""
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.api.access import not_found, owned_school
from app.api.deps import current_user
from app.api.people import temporary_password
from app.core.db import get_db
from app.core.security import hash_password
from app.models import Board, BoardMember, Branch, Membership, Role, StaffProfile, User

router = APIRouter(prefix="/api", tags=["logins"])

ROLE_LABEL = {
    Role.owner: "Owner", Role.head: "Head", Role.bursar: "Bursar", Role.teacher: "Teacher",
    Role.house_parent: "House parent", Role.support: "Support staff", Role.parent: "Parent",
    Role.student: "Student", Role.board_member: "Board member",
}
KIND = {Role.parent: "parent", Role.board_member: "board", Role.student: "student"}


class LoginOut(BaseModel):
    user_id: uuid.UUID
    full_name: str
    title: str | None
    username: str
    phone: str | None
    email: str | None
    roles: list[str]
    kind: str               # staff, board, parent, student
    is_active: bool
    must_change_password: bool
    last_login_at: datetime | None
    is_admin: bool          # an owner: managed by themselves, not reset here


def _people(db: Session, school_id: uuid.UUID) -> dict[uuid.UUID, tuple[User, set[Role]]]:
    branch_ids = list(db.scalars(select(Branch.id).where(Branch.school_id == school_id)))
    rows = db.scalars(select(Membership).where(or_(
        Membership.school_id == school_id, Membership.branch_id.in_(branch_ids)))).all()
    people: dict[uuid.UUID, tuple[User, set[Role]]] = {}
    for m in rows:
        people.setdefault(m.user_id, (m.user, set()))[1].add(m.role)
    # Board members are also people of this school.
    for bm in db.scalars(select(BoardMember).join(Board).where(Board.school_id == school_id)):
        people.setdefault(bm.user_id, (bm.user, set()))[1].add(Role.board_member)
    return people


def _is_owner(db: Session, user_id: uuid.UUID) -> bool:
    return bool(db.scalar(select(Membership.id).where(Membership.user_id == user_id, Membership.role == Role.owner)))


def _out(db: Session, school_id: uuid.UUID, user: User, roles: set[Role], titles: dict) -> LoginOut:
    staffish = roles - {Role.parent, Role.board_member, Role.student, Role.owner}
    kind = "staff" if staffish else KIND.get(next(iter(sorted(roles, key=lambda r: r.value)), Role.parent), "staff")
    if Role.board_member in roles and not staffish:
        kind = "board"
    return LoginOut(
        user_id=user.id, full_name=user.full_name, title=titles.get(user.id), username=user.phone or user.email or "",
        phone=user.phone, email=user.email, roles=sorted(ROLE_LABEL[r] for r in roles), kind=kind,
        is_active=user.is_active, must_change_password=user.must_change_password, last_login_at=user.last_login_at,
        is_admin=Role.owner in roles or _is_owner(db, user.id),
    )


def _target(db: Session, admin: User, school_id: uuid.UUID, user_id: uuid.UUID) -> User:
    owned_school(db, admin, school_id)
    people = _people(db, school_id)
    if user_id not in people:
        raise not_found("Person")
    if user_id == admin.id:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Change your own password from your own account")
    if _is_owner(db, user_id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Owners manage their own logins")
    return people[user_id][0]


@router.get("/schools/{school_id}/logins", response_model=list[LoginOut])
def list_logins(school_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    owned_school(db, user, school_id)
    people = _people(db, school_id)
    titles = {p.user_id: p.title for p in db.scalars(select(StaffProfile).where(StaffProfile.school_id == school_id)) if p.title}
    out = [_out(db, school_id, u, roles, titles) for u, roles in people.values()]
    order = {"staff": 0, "board": 1, "parent": 2, "student": 3}
    return sorted(out, key=lambda x: (order.get(x.kind, 9), x.full_name.lower()))


@router.get("/schools/{school_id}/logins/{user_id}", response_model=LoginOut)
def one_login(school_id: uuid.UUID, user_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    owned_school(db, user, school_id)
    people = _people(db, school_id)
    if user_id not in people:
        raise not_found("Person")
    titles = {p.user_id: p.title for p in db.scalars(select(StaffProfile).where(StaffProfile.school_id == school_id,
                                                                               StaffProfile.user_id == user_id)) if p.title}
    u, roles = people[user_id]
    return _out(db, school_id, u, roles, titles)


class ResetIn(BaseModel):
    password: str | None = Field(default=None, min_length=8, max_length=128)  # blank: make one up


class ResetOut(BaseModel):
    name: str
    username: str
    password: str


@router.post("/schools/{school_id}/logins/{user_id}/reset-password", response_model=ResetOut)
def reset_password(school_id: uuid.UUID, user_id: uuid.UUID, data: ResetIn,
                   user: User = Depends(current_user), db: Session = Depends(get_db)):
    person = _target(db, user, school_id, user_id)
    password = data.password or temporary_password()
    person.password_hash = hash_password(password)
    person.must_change_password = True
    person.is_active = True
    db.commit()
    return ResetOut(name=person.full_name, username=person.phone or person.email or "", password=password)


class ActiveIn(BaseModel):
    active: bool


@router.put("/schools/{school_id}/logins/{user_id}/active", response_model=LoginOut)
def set_active(school_id: uuid.UUID, user_id: uuid.UUID, data: ActiveIn,
               user: User = Depends(current_user), db: Session = Depends(get_db)):
    person = _target(db, user, school_id, user_id)
    person.is_active = data.active
    db.commit()
    return one_login(school_id, user_id, user, db)
