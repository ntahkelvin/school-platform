"""Builds the standard list / add / edit / delete endpoints for simple school records,
so each new kind of record (houses, clubs, vehicles...) only needs its fields described once."""
import uuid
from collections.abc import Callable
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.access import not_found, owned_branch, owned_school
from app.api.deps import current_user
from app.core.db import Base, get_db
from app.models import Branch, Department, Membership, Role, School, Section, User


def check_refs(db: Session, school: School, data: dict[str, Any]) -> None:
    """Makes sure anything a record points at (a person, department, section, branch) is in the same school."""
    for key, value in data.items():
        if value is None:
            continue
        if key.endswith("_user_id"):
            # Must work at this school, or be an owner of the whole group.
            linked = db.scalar(select(Membership.id).where(
                Membership.user_id == value,
                Membership.group_id == school.group_id,
                (Membership.school_id == school.id) | (Membership.role == Role.owner),
            ))
            if not linked:
                raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "That person isn't part of this school")
        elif key == "department_id":
            d = db.get(Department, value)
            if not d or d.school_id != school.id:
                raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "That department isn't in this school")
        elif key == "section_id":
            s = db.get(Section, value)
            if not s or s.school_id != school.id:
                raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "That section isn't in this school")
        elif key == "branch_id":
            b = db.get(Branch, value)
            if not b or b.school_id != school.id:
                raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "That branch isn't in this school")


def clean(data: dict[str, Any]) -> dict[str, Any]:
    """Trims text and turns empty text into 'not set'."""
    out = {}
    for k, v in data.items():
        if isinstance(v, str):
            v = v.strip() or None
        out[k] = v
    return out


def commit_or_conflict(db: Session, what: str) -> None:
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, f"A {what} with that name already exists")


def add_crud(
    router: APIRouter,
    *,
    model: type[Base],
    path: str,
    parent: str,  # "school" or "branch"
    schema_in: type[BaseModel],
    schema_out: type[BaseModel],
    what: str,
    order_by: list[Any],
    validate: Callable[[Session, School, dict[str, Any], Any], None] | None = None,
) -> None:
    parent_col = getattr(model, f"{parent}_id")

    def parent_and_school(db: Session, user: User, pid: uuid.UUID) -> tuple[Any, School]:
        if parent == "school":
            s = owned_school(db, user, pid)
            return s, s
        b = owned_branch(db, user, pid)
        return b, b.school

    def own(db: Session, user: User, obj_id: uuid.UUID) -> tuple[Any, School]:
        obj = db.get(model, obj_id)
        if not obj:
            raise not_found(what.capitalize())
        _, school = parent_and_school(db, user, getattr(obj, f"{parent}_id"))
        return obj, school

    def prepare(db: Session, school: School, data: BaseModel, existing: Any) -> dict[str, Any]:
        values = clean(data.model_dump())
        check_refs(db, school, values)
        if validate:
            validate(db, school, values, existing)
        return values

    @router.get(f"/{parent}es/{{pid}}/{path}" if parent == "branch" else f"/{parent}s/{{pid}}/{path}",
                response_model=list[schema_out], name=f"list_{path}")
    def list_items(pid: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
        parent_and_school(db, user, pid)
        return list(db.scalars(select(model).where(parent_col == pid).order_by(*order_by)).unique())

    @router.post(f"/{parent}es/{{pid}}/{path}" if parent == "branch" else f"/{parent}s/{{pid}}/{path}",
                 response_model=schema_out, status_code=201, name=f"add_{path}")
    def add_item(pid: uuid.UUID, data: schema_in, user: User = Depends(current_user), db: Session = Depends(get_db)):  # type: ignore[valid-type]
        _, school = parent_and_school(db, user, pid)
        obj = model(**{f"{parent}_id": pid, **prepare(db, school, data, None)})
        db.add(obj)
        commit_or_conflict(db, what)
        db.refresh(obj)
        return obj

    @router.patch(f"/{path}/{{obj_id}}", response_model=schema_out, name=f"update_{path}")
    def update_item(obj_id: uuid.UUID, data: schema_in, user: User = Depends(current_user), db: Session = Depends(get_db)):  # type: ignore[valid-type]
        obj, school = own(db, user, obj_id)
        for k, v in prepare(db, school, data, obj).items():
            setattr(obj, k, v)
        commit_or_conflict(db, what)
        db.refresh(obj)
        return obj

    @router.delete(f"/{path}/{{obj_id}}", status_code=204, name=f"delete_{path}")
    def delete_item(obj_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
        obj, _ = own(db, user, obj_id)
        db.delete(obj)
        db.commit()
        return Response(status_code=204)
