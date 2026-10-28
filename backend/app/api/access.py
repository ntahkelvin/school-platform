"""Checks that the logged-in user may manage a given school or branch.

For now only owners manage things. Week 7 adds heads, bursars and teachers.
Anything the user can't see is reported as "not found", so nobody can guess
other schools' records.
"""
import uuid

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import owned_group_ids
from app.models import Branch, School, SchoolGroup, User


def not_found(what: str) -> HTTPException:
    return HTTPException(status.HTTP_404_NOT_FOUND, f"{what} not found")


def owned_group(db: Session, user: User, group_id: uuid.UUID) -> SchoolGroup:
    group = db.get(SchoolGroup, group_id)
    if not group or group_id not in owned_group_ids(user):
        raise not_found("School group")
    return group


def owned_school(db: Session, user: User, school_id: uuid.UUID) -> School:
    school = db.get(School, school_id)
    if not school or school.group_id not in owned_group_ids(user):
        raise not_found("School")
    return school


def owned_branch(db: Session, user: User, branch_id: uuid.UUID) -> Branch:
    branch = db.get(Branch, branch_id)
    if not branch or branch.school.group_id not in owned_group_ids(user):
        raise not_found("Branch")
    return branch
