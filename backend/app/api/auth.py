import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.api.deps import current_user
from app.core.db import get_db
from app.core.security import create_access_token, verify_password
from app.models import Role, User

router = APIRouter(prefix="/api", tags=["auth"])


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


class MembershipOut(BaseModel):
    role: Role
    group_id: uuid.UUID
    school_id: uuid.UUID | None
    branch_id: uuid.UUID | None

    model_config = {"from_attributes": True}


class MeOut(BaseModel):
    id: uuid.UUID
    full_name: str
    email: str | None
    phone: str | None
    memberships: list[MembershipOut]

    model_config = {"from_attributes": True}


@router.post("/auth/login", response_model=Token)
def login(form: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)) -> Token:
    """Log in with an email address or phone number, plus password."""
    identifier = form.username.strip().lower()
    user = db.scalar(select(User).where(or_(User.email == identifier, User.phone == identifier)))
    if not user or not user.is_active or not verify_password(form.password, user.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Wrong email/phone or password")
    return Token(access_token=create_access_token(str(user.id)))


@router.get("/me", response_model=MeOut)
def me(user: User = Depends(current_user)) -> User:
    return user
