"""Creates the real owner login on a server (instead of the demo one).

Run with:  python -m app.make_owner "Full Name" email@example.com "Group name"
The password is read from the OWNER_PASSWORD environment variable so it never shows in the command history.
If the email already exists, its password is reset and it is made an owner.
"""
import os
import sys

from sqlalchemy import select

from app.core.db import SessionLocal
from app.core.security import hash_password
from app.models import Membership, Role, SchoolGroup, User


def main() -> None:
    if len(sys.argv) < 4 or not os.environ.get("OWNER_PASSWORD"):
        sys.exit('Usage: OWNER_PASSWORD=... python -m app.make_owner "Full Name" email "Group name"')
    name, email, group_name = sys.argv[1], sys.argv[2].strip().lower(), sys.argv[3]
    password = os.environ["OWNER_PASSWORD"]
    if len(password) < 8:
        sys.exit("The password must be at least 8 characters")
    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.email == email))
        if user:
            user.password_hash = hash_password(password)
            user.full_name = name
        else:
            user = User(full_name=name, email=email, password_hash=hash_password(password))
            db.add(user)
            db.flush()
        if not any(m.role == Role.owner for m in user.memberships):
            group = db.scalar(select(SchoolGroup).where(SchoolGroup.name == group_name))
            if not group:
                group = SchoolGroup(name=group_name)
                db.add(group)
                db.flush()
            db.add(Membership(user_id=user.id, role=Role.owner, group_id=group.id))
        db.commit()
        print(f"Owner ready. Log in with {email}")


if __name__ == "__main__":
    main()
