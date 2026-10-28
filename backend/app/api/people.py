"""Shared helper: find a person by phone/email, or create them."""
import secrets

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.phone import normalize_phone
from app.core.security import hash_password
from app.models import User


def temporary_password() -> str:
    # Easy to read out over the phone: no 0/O or 1/l confusion.
    alphabet = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789"
    return "".join(secrets.choice(alphabet) for _ in range(10))


def find_or_create_user(
    db: Session, full_name: str, phone: str | None, email: str | None
) -> tuple[User, str | None]:
    """Returns (user, temporary_password). The password is None if the person already existed."""
    phone = normalize_phone(phone)
    email = (email or "").strip().lower() or None
    if not phone and not email:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Enter a phone number or an email address")

    by_phone = db.scalar(select(User).where(User.phone == phone)) if phone else None
    by_email = db.scalar(select(User).where(User.email == email)) if email else None
    if by_phone and by_email and by_phone.id != by_email.id:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "That phone number and email belong to two different people. Use just one of them.",
        )
    existing = by_phone or by_email
    if existing:
        # Fill in any contact detail we didn't have before.
        if phone and not existing.phone:
            existing.phone = phone
        if email and not existing.email:
            existing.email = email
        return existing, None

    password = temporary_password()
    user = User(full_name=full_name.strip(), phone=phone, email=email, password_hash=hash_password(password))
    db.add(user)
    db.flush()
    return user, password
