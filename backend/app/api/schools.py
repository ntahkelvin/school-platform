import uuid

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.api.access import owned_branch, owned_group, owned_school
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


class BranchDetail(BranchOut):
    school_id: uuid.UUID
    school_name: str
    school_type: SchoolType


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
    owned_group(db, user, group_id)
    school = School(group_id=group_id, name=data.name.strip(), school_type=data.school_type)
    db.add(school)
    db.commit()
    db.refresh(school)
    return school


@router.get("/schools/{school_id}", response_model=SchoolOut)
def get_school(school_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)) -> School:
    return owned_school(db, user, school_id)


@router.patch("/schools/{school_id}", response_model=SchoolOut)
def update_school(
    school_id: uuid.UUID, data: SchoolIn, user: User = Depends(current_user), db: Session = Depends(get_db)
) -> School:
    school = owned_school(db, user, school_id)
    school.name = data.name.strip()
    school.school_type = data.school_type
    db.commit()
    db.refresh(school)
    return school


@router.post("/schools/{school_id}/branches", response_model=BranchOut, status_code=201)
def add_branch(
    school_id: uuid.UUID, data: BranchIn, user: User = Depends(current_user), db: Session = Depends(get_db)
) -> Branch:
    school = owned_school(db, user, school_id)
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


def _branch_detail(branch: Branch) -> BranchDetail:
    return BranchDetail(
        id=branch.id,
        name=branch.name,
        address=branch.address,
        has_boarding=branch.has_boarding,
        school_id=branch.school_id,
        school_name=branch.school.name,
        school_type=branch.school.school_type,
    )


@router.get("/branches/{branch_id}", response_model=BranchDetail)
def get_branch(branch_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)) -> BranchDetail:
    return _branch_detail(owned_branch(db, user, branch_id))


@router.patch("/branches/{branch_id}", response_model=BranchDetail)
def update_branch(
    branch_id: uuid.UUID, data: BranchIn, user: User = Depends(current_user), db: Session = Depends(get_db)
) -> BranchDetail:
    branch = owned_branch(db, user, branch_id)
    branch.name = data.name.strip()
    branch.address = (data.address or "").strip() or None
    branch.has_boarding = data.has_boarding
    db.commit()
    db.refresh(branch)
    return _branch_detail(branch)
