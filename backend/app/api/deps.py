import uuid

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core import rights
from app.core.security import decode_token
from app.models import Role, School, User

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")


def current_user(request: Request, token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)) -> User:
    body = decode_token(token)
    try:
        user = db.get(User, uuid.UUID(body["sub"])) if body else None
    except (ValueError, KeyError):
        user = None
    if not user or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Please log in again")
    route = request.scope.get("route")
    if route is not None:
        rights.set_route(user, request.method, route.endpoint.__module__.rsplit(".", 1)[-1], route.path.removeprefix("/api"))
    if body.get("act"):
        actor = db.get(User, uuid.UUID(body["act"]))
        if not actor or not actor.is_active:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Please log in again")
        user.__dict__["acting_by"] = actor
        user.__dict__["acting_school"] = uuid.UUID(body["sch"]) if body.get("sch") else None
        if request.method not in ("GET", "HEAD") and not request.url.path.endswith("/see-as/stop"):
            raise HTTPException(status.HTTP_403_FORBIDDEN, f"You are seeing the platform as {user.full_name}. Nothing can be changed. Stop 'see as' first.")
    return user


def owned_group_ids(user: User) -> set[uuid.UUID]:
    """Groups where this user is the owner. While someone is 'seeing as' an owner, only groups they own too."""
    mine = {m.group_id for m in user.memberships if m.role == Role.owner}
    actor = user.__dict__.get("acting_by")
    if actor is not None:
        mine &= {m.group_id for m in actor.memberships if m.role == Role.owner}
    return mine


# People who run one school day to day. They can set it up and manage it, but not delete or move it.
MANAGER_ROLES = {Role.head_of_school, Role.head, Role.vice_principal, Role.it_admin}


def managed_school_ids(user: User) -> set[uuid.UUID]:
    """Schools whose pages this user may open (any 'see' right), not counting schools they own."""
    from sqlalchemy.orm import object_session
    db = object_session(user)
    ids = {m.school_id for m in user.memberships if m.school_id and m.role not in (Role.parent, Role.student, Role.board_member)}
    out = set()
    for sid in ids:
        s = db.get(School, sid)
        if s and rights.any_area(user, s):
            out.add(sid)
    return out
