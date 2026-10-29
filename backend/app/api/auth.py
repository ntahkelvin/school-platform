import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel, Field
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.api.deps import current_user
from app.core.db import get_db
from app.core.phone import looks_like_phone, normalize_phone
from app.core.security import create_access_token, hash_password, verify_password
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
    must_change_password: bool = False
    memberships: list[MembershipOut]

    model_config = {"from_attributes": True}


@router.post("/auth/login", response_model=Token)
def login(form: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)) -> Token:
    """Log in with an email address or phone number, plus password."""
    identifier = form.username.strip().lower()
    phone = normalize_phone(identifier) if looks_like_phone(identifier) else None
    user = db.scalar(select(User).where(or_(User.email == identifier, User.phone == (phone or identifier))))
    if not user or not user.is_active or not verify_password(form.password, user.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Wrong email/phone or password")
    user.last_login_at = datetime.now(timezone.utc)
    db.commit()
    return Token(access_token=create_access_token(str(user.id)))


@router.get("/me", response_model=MeOut)
def me(user: User = Depends(current_user)) -> User:
    return user


class PasswordChange(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8, max_length=128)


@router.post("/me/password", status_code=204)
def change_password(data: PasswordChange, user: User = Depends(current_user), db: Session = Depends(get_db)) -> None:
    if not verify_password(data.current_password, user.password_hash):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Your current password isn't right")
    if data.new_password == data.current_password:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Choose a password different from the one you were given")
    if data.new_password.isdigit() or len(set(data.new_password)) < 4:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "That password is too easy to guess. Mix letters and numbers.")
    user.password_hash = hash_password(data.new_password)
    user.must_change_password = False
    db.commit()
