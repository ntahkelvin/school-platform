from datetime import datetime, timedelta, timezone

import bcrypt
import jwt

from app.core.config import settings

ALGORITHM = "HS256"


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode(), hashed.encode())
    except ValueError:
        return False


def create_access_token(user_id: str, actor_id: str | None = None, school_id: str | None = None, minutes: int | None = None) -> str:
    """A login token. With actor_id it is a 'see as' token: actor_id is looking at the platform as user_id."""
    expires = datetime.now(timezone.utc) + timedelta(minutes=minutes or settings.access_token_minutes)
    body = {"sub": user_id, "exp": expires}
    if actor_id:
        body |= {"act": actor_id, "sch": school_id}
    return jwt.encode(body, settings.secret_key, algorithm=ALGORITHM)


def decode_token(token: str) -> dict | None:
    try:
        return jwt.decode(token, settings.secret_key, algorithms=[ALGORITHM])
    except jwt.PyJWTError:
        return None


def decode_access_token(token: str) -> str | None:
    d = decode_token(token)
    return d.get("sub") if d else None
