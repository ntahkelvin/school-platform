"""Checks that the logged-in user may use a given school or branch's pages.

What they may do comes from their rights (app.core.rights): reading needs "see" for the page's area,
saving needs "change". Anything the user can't see at all is reported as "not found", so nobody can
guess other schools' records; seeing but not changing gives a clear "you can look but not change" message.
"""
import uuid

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import owned_group_ids
from app.core import rights
from app.models import Branch, School, SchoolGroup, User


def not_found(what: str) -> HTTPException:
    return HTTPException(status.HTTP_404_NOT_FOUND, f"{what} not found")


def owned_group(db: Session, user: User, group_id: uuid.UUID) -> SchoolGroup:
    group = db.get(SchoolGroup, group_id)
    if not group or group_id not in owned_group_ids(user):
        raise not_found("School group")
    return group


def check(user: User, school: School, area: str | None = None) -> None:
    """Raise unless the user may do what this page does (see or change) in this school."""
    if rights.may(user, school, area):
        return
    if rights.any_area(user, school):
        need = rights.route_need(user)
        a = rights.AREAS.get(area or (need[0] if need else "school"), {"label": "this"})["label"]
        if rights.acting(user):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Nothing can be changed while seeing as someone else")
        if need and need[1] == "change" and rights.has(user, school, f"{area or need[0]}.see"):
            raise HTTPException(status.HTTP_403_FORBIDDEN, f"You can look at {a.lower()} but not change it. Ask the principal if you need to.")
        raise HTTPException(status.HTTP_403_FORBIDDEN, f"{a} is not open to you. Ask the principal if you need it.")
    raise not_found("School")


def owned_school(db: Session, user: User, school_id: uuid.UUID, area: str | None = None) -> School:
    """The school, if this user may use this page of it (see their rights)."""
    school = db.get(School, school_id)
    if not school:
        raise not_found("School")
    check(user, school, area)
    return school


def owner_school(db: Session, user: User, school_id: uuid.UUID) -> School:
    """The school, only if this user owns its organisation (for deleting or moving it)."""
    school = db.get(School, school_id)
    if not school or school.group_id not in owned_group_ids(user) or rights.acting(user):
        raise not_found("School")
    return school


def owned_branch(db: Session, user: User, branch_id: uuid.UUID) -> Branch:
    branch = db.get(Branch, branch_id)
    if not branch:
        raise not_found("Branch")
    check(user, branch.school)
    return branch


def member_branch(db: Session, user: User, branch_id: uuid.UUID) -> Branch:
    """The branch, if the user runs it or works there in any role (for reading its basic details)."""
    branch = db.get(Branch, branch_id)
    if not branch:
        raise not_found("Branch")
    if rights.any_area(user, branch.school):
        return branch
    if any(m.branch_id == branch.id or m.school_id == branch.school_id for m in user.memberships):
        return branch
    raise not_found("Branch")
