import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.api.deps import current_user, owned_group_ids
from app.core.db import get_db
from app.models import Branch, School, SchoolGroup, SchoolType, User

router = APIRouter(prefix="/api", tags=["schools"])


class BranchIn(BaseModel):
    name: str = Field(min_length=2, max_length=200)
    address: str | None = None
    has_boarding: bool = False


class BranchOut(BranchIn):
    id: uuid.UUID
    model_config = {"from_attributes": True}


class SchoolIn(BaseModel):
    name: str = Field(min_length=2, max_length=200)
    school_type: SchoolType = SchoolType.day


class SchoolOut(SchoolIn):
    id: uuid.UUID
    branches: list[BranchOut]
    model_config = {"from_attributes": True}


class GroupOut(BaseModel):
    id: uuid.UUID
    name: str
    schools: list[SchoolOut]
    model_config = {"from_attributes": True}


def _owned_group(db: Session, user: User, group_id: uuid.UUID) -> SchoolGroup:
    group = db.get(SchoolGroup, group_id)
    if not group or group_id not in owned_group_ids(user):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "School group not found")
    return group


def _owned_school(db: Session, user: User, school_id: uuid.UUID) -> School:
    school = db.get(School, school_id)
    if not school or school.group_id not in owned_group_ids(user):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "School not found")
    return school


@router.get("/groups", response_model=list[GroupOut])
def my_groups(user: User = Depends(current_user), db: Session = Depends(get_db)) -> list[SchoolGroup]:
    """Every school group this user owns, with its schools and branches."""
    ids = owned_group_ids(user)
    if not ids:
        return []
    stmt = (
        select(SchoolGroup)
        .where(SchoolGroup.id.in_(ids))
        .options(selectinload(SchoolGroup.schools).selectinload(School.branches))
        .order_by(SchoolGroup.name)
    )
    return list(db.scalars(stmt))


@router.post("/groups/{group_id}/schools", response_model=SchoolOut, status_code=201)
def add_school(
    group_id: uuid.UUID, data: SchoolIn, user: User = Depends(current_user), db: Session = Depends(get_db)
) -> School:
    _owned_group(db, user, group_id)
    school = School(group_id=group_id, name=data.name.strip(), school_type=data.school_type)
    db.add(school)
    db.commit()
    db.refresh(school)
    return school


@router.post("/schools/{school_id}/branches", response_model=BranchOut, status_code=201)
def add_branch(
    school_id: uuid.UUID, data: BranchIn, user: User = Depends(current_user), db: Session = Depends(get_db)
) -> Branch:
    school = _owned_school(db, user, school_id)
    branch = Branch(
        school_id=school.id,
        name=data.name.strip(),
        address=(data.address or "").strip() or None,
        has_boarding=data.has_boarding,
    )
    db.add(branch)
    db.commit()
    db.refresh(branch)
    return branch
