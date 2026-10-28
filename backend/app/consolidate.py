"""Makes sure every school is exactly one site.

- A school with no campus record gets one.
- A school with several branches (from before the platform became "organisation, then schools")
  is split: each extra branch becomes its own school in the same organisation, named
  "School name (Branch name)", with a copy of the school's set-up. Rename it afterwards.
- Every campus takes its school's name and boarding setting.

Safe to run any number of times. setup.sh runs it for you.
Run by hand with:  python -m app.consolidate
"""
from sqlalchemy import select

from app.api.organisations import split_branch
from app.core.db import SessionLocal
from app.models import Branch, School


def consolidate() -> list[str]:
    report: list[str] = []
    with SessionLocal() as db:
        for school in list(db.scalars(select(School).order_by(School.created_at))):
            branches = sorted(school.branches, key=lambda b: b.created_at)
            if not branches:
                db.add(Branch(school_id=school.id, name=school.name, has_boarding=school.has_boarding))
                report.append(f"{school.name}: set up its campus")
                continue
            taken = {s.name.lower() for s in school.group.schools}
            for extra in branches[1:]:
                old_name = extra.name
                name = f"{school.name} ({extra.name})"
                n = 2
                while name.lower() in taken:
                    name = f"{school.name} ({extra.name} {n})"
                    n += 1
                taken.add(name.lower())
                split_branch(db, extra, name, None, copy_setup=True)
                report.append(f"{old_name} is now its own school: {name}")
            db.flush()
        db.expire_all()
        for school in db.scalars(select(School)):
            for b in school.branches:
                b.name = school.name
                b.has_boarding = school.has_boarding
        db.commit()
    return report


if __name__ == "__main__":
    lines = consolidate()
    if lines:
        print("Schools tidied up:")
        for line in lines:
            print(f"  - {line}")
    else:
        print("Every school is already a single site. Nothing to change.")
