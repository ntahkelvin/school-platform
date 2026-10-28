"""Creates a demo school group and an owner login so you can try the app.

Run with:  python -m app.seed
Safe to run more than once.
"""
from sqlalchemy import select

from app.core.db import SessionLocal
from app.core.security import hash_password
from app.models import Membership, Role, SchoolGroup, User

OWNER_EMAIL = "owner@demo.local"
OWNER_PASSWORD = "ChangeMe123!"


def main() -> None:
    with SessionLocal() as db:
        if db.scalar(select(User).where(User.email == OWNER_EMAIL)):
            print(f"Demo owner already exists. Log in with {OWNER_EMAIL} / {OWNER_PASSWORD}")
            return
        group = SchoolGroup(name="Demo Schools Group")
        owner = User(full_name="Demo Owner", email=OWNER_EMAIL, password_hash=hash_password(OWNER_PASSWORD))
        db.add_all([group, owner])
        db.flush()
        db.add(Membership(user_id=owner.id, role=Role.owner, group_id=group.id))
        db.commit()
        print(f"Created demo owner. Log in with {OWNER_EMAIL} / {OWNER_PASSWORD}")


if __name__ == "__main__":
    main()
