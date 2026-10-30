import uuid

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.security import decode_access_token
from app.models import Role, User

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")


def current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)) -> User:
    user_id = decode_access_token(token)
    user = db.get(User, uuid.UUID(user_id)) if user_id else None
    if not user or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Please log in again")
    return user


def owned_group_ids(user: User) -> set[uuid.UUID]:
    """Groups where this user is the owner."""
    return {m.group_id for m in user.memberships if m.role == Role.owner}


# People who run one school day to day. They can set it up and manage it, but not delete or move it.
MANAGER_ROLES = {Role.head, Role.vice_principal, Role.it_admin}


def managed_school_ids(user: User) -> set[uuid.UUID]:
    """Schools this user runs as principal, vice principal or IT admin."""
    return {m.school_id for m in user.memberships if m.role in MANAGER_ROLES and m.school_id}
