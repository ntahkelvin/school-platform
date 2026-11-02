"""Who may see and change what, in one place.

Every role gets ready-made rights. The owner (and the head of school) can change them for a whole role
or for one person on the Rights page. Private records (medical, safeguarding, staff pay) need their own
right, and anyone without it can ask the principal for access for a few hours.

The page being used decides which area is being checked: reading a page needs "see", saving needs "change".
"""
import re
import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session, object_session

from app.models import AccessGrant, Membership, RightSetting, Role, School, User

# ---------- The catalogue ----------

AREAS: dict[str, dict] = {
    "school": {"label": "School details", "icon": "overview", "hint": "Overview, name, logo, contact details"},
    "students": {"label": "Students", "icon": "students", "hint": "Student records, parents, electives"},
    "attendance": {"label": "Attendance", "icon": "attendance", "hint": "Every class register and night roll"},
    "classes": {"label": "Classes", "icon": "classes", "hint": "Classes, sessions and terms"},
    "teaching": {"label": "Teaching", "icon": "presentation", "hint": "Subjects, form teachers, who teaches what"},
    "staff": {"label": "Staff", "icon": "staff", "hint": "Staff list, jobs and staff records"},
    "staff_day": {"label": "Staff day", "icon": "staff-day", "hint": "Staff sign-in, leave, duties, lesson notes"},
    "growth": {"label": "Growth", "icon": "growth", "hint": "Observations, appraisals, training, wellbeing"},
    "operations": {"label": "Operations", "icon": "operations", "hint": "Helpdesk, gate, kitchen, transport, store"},
    "facilities": {"label": "Facilities and assets", "icon": "facilities", "hint": "Buildings, hostels and beds, vehicles, the asset register"},
    "library": {"label": "Library", "icon": "book", "hint": "Books, loans, library cards and reading"},
    "setup": {"label": "School set-up", "icon": "sections", "hint": "Sections, departments, houses, grading, calendar, rules"},
    "imports": {"label": "Bulk upload", "icon": "layers", "hint": "Upload lists of students and staff", "change_only": True},
    "logins": {"label": "Logins and passwords", "icon": "shield-check", "hint": "Give logins, reset passwords, switch off accounts"},
    "rights": {"label": "Rights", "icon": "shield", "hint": "This page: who may see and change what"},
}
PRIVATE: dict[str, dict] = {
    "health": {"label": "Medical records", "icon": "heart-pulse", "hint": "Health records, sick bay visits and the nurse's notes"},
    "safeguarding": {"label": "Incidents and safeguarding", "icon": "flame", "hint": "Incident reports, fights, bullying, abuse"},
    "staff_pay": {"label": "Staff pay and bank details", "icon": "coins", "hint": "Grade level, salary step and bank account of each staff member"},
}
POWERS: dict[str, dict] = {
    "see_as": {"label": "See as someone else", "icon": "eye", "hint": "Look at the platform the way another person sees it, to help them. Read-only."},
}


def all_rights() -> list[str]:
    out = []
    for k, a in AREAS.items():
        if not a.get("change_only"):
            out.append(f"{k}.see")
        out.append(f"{k}.change")
    out += [f"private.{k}" for k in PRIVATE] + [f"power.{k}" for k in POWERS]
    return out


ALL = set(all_rights())
AREA_KEYS = list(AREAS)

# Higher rank may set rights for lower ranks only.
RANK = {"owner": 100, "head_of_school": 90, "head": 80, "vice_principal": 70, "it_admin": 60, "bursar": 50,
        "house_parent": 30, "teacher": 30, "support": 20}
ROLE_LABEL = {"head_of_school": "Head of school", "head": "Principal", "vice_principal": "Vice principal", "it_admin": "ICT admin",
              "bursar": "Bursar", "teacher": "Teacher", "house_parent": "House parent", "support": "Support staff"}
SCHOOL_ROLES = ["head_of_school", "head", "vice_principal", "it_admin", "bursar", "house_parent", "teacher", "support"]


def _both(*areas: str) -> set[str]:
    return {f"{a}.see" for a in areas if not AREAS[a].get("change_only")} | {f"{a}.change" for a in areas}


def _see(*areas: str) -> set[str]:
    return {f"{a}.see" for a in areas}


DEFAULTS: dict[str, set[str]] = {
    "head_of_school": set(ALL),
    "head": (ALL - {"rights.change"}),
    "vice_principal": _see(*[a for a in AREA_KEYS if a not in ("imports", "logins", "rights")])
        | _both("students", "attendance", "classes", "teaching", "staff_day", "growth", "operations", "library")
        | {"private.safeguarding"},
    "it_admin": _see(*[a for a in AREA_KEYS if a != "imports"])
        | _both("school", "students", "classes", "teaching", "staff", "staff_day", "operations", "facilities", "setup", "imports", "logins", "library")
        | {"power.see_as"},
    "bursar": _see("school", "students", "staff", "facilities") | {"private.staff_pay"},
    "house_parent": set(),
    "teacher": set(),
    "support": set(),
}

# ---------- Which area each page belongs to ----------

# (module, path pattern) -> area. Checked in order; the path has the /api prefix removed.
ROUTE_AREAS: list[tuple[str, str, str]] = [
    ("academics", r"^/(schools/\{\w+\}/sessions|terms/)", "classes"),
    ("academics", r"subjects", "teaching"),
    ("academics", r"", "classes"),
    ("attendance", r"", "attendance"),
    ("crud", r"/(facilities|vehicles|hostels)", "facilities"),
    ("crud", r"", "setup"),
    ("electives", r"", "teaching"),
    ("growth", r"", "growth"),
    ("imports", r"", "imports"),
    ("logins", r"", "logins"),
    ("logistics", r"facilit", "facilities"),
    ("logistics", r"", "operations"),
    ("ops", r"", "operations"),
    ("schools", r"^/branches", "setup"),
    ("schools", r"", "school"),
    ("staff", r"", "staff"),
    ("staff_day", r"", "staff_day"),
    ("staff_records", r"", "staff"),
    ("starter", r"", "setup"),
    ("structure", r"/profile|setup-counts", "school"),
    ("structure", r"staff-options", "staff"),
    ("structure", r"hostel|beds", "facilities"),
    ("structure", r"", "setup"),
    ("students", r"", "students"),
    ("student360", r"", "students"),
    ("student_year", r"", "students"),
    ("family", r"family-notes", "students"),
    ("family", r"", "logins"),
    ("admissions", r"", "students"),
    ("teaching", r"", "teaching"),
    ("units", r"", "setup"),
    ("boards", r"", "school"),
    ("rights", r"", "rights"),
    ("library", r"", "library"),
    ("cleaning", r"", "operations"),
    ("assets", r"", "facilities"),
]

def set_route(user: User, method: str, module: str, path: str) -> None:
    # Kept on the user object for this request (dependencies run in other threads, so a context variable would be lost).
    user.__dict__["_route"] = (method, module, path)


def route_need(user: User) -> tuple[str, str] | None:
    """(area, 'see' or 'change') for the page being used, or None outside a web request."""
    r = user.__dict__.get("_route")
    if not r:
        return None
    method, module, path = r
    level = "see" if method in ("GET", "HEAD") else "change"
    for mod, pat, area in ROUTE_AREAS:
        if mod == module and re.search(pat, path):
            return area, ("change" if AREAS[area].get("change_only") else level)
    return "school", level


def is_writing(user: User) -> bool:
    r = user.__dict__.get("_route")
    return bool(r) and r[0] not in ("GET", "HEAD")


# ---------- Working out someone's rights ----------

def roles_at(user: User, school: School) -> set[str]:
    return {m.role.value for m in user.memberships
            if m.role not in (Role.owner, Role.parent, Role.student, Role.board_member) and m.school_id == school.id}


def owns(user: User, school: School) -> bool:
    return any(m.role == Role.owner and m.group_id == school.group_id for m in user.memberships)


def _computed(db: Session, user: User, school: School) -> set[str]:
    if owns(user, school):
        return set(ALL)
    roles = roles_at(user, school)
    settings = list(db.scalars(select(RightSetting).where(RightSetting.school_id == school.id)))
    have: set[str] = set()
    for role in roles:
        r = set(DEFAULTS.get(role, set()))
        for s in settings:
            if s.role == role and s.user_id is None:
                (r.add if s.allowed else r.discard)(s.right)
        have |= r
    for s in settings:
        if s.user_id == user.id:
            (have.add if s.allowed else have.discard)(s.right)
    now = datetime.now(timezone.utc)
    grants = db.scalars(select(AccessGrant).where(AccessGrant.school_id == school.id, AccessGrant.user_id == user.id,
                                                  AccessGrant.status == "approved", AccessGrant.expires_at > now))
    granted = {g.right for g in grants}
    user.__dict__.setdefault("_granted", {})[school.id] = granted - have
    return have | granted


def rights_of(user: User, school: School, db: Session | None = None) -> set[str]:
    """Everything this person may do in this school. When 'seeing as' someone, only what both people may see:
    nothing private and nothing that changes anything."""
    cache = user.__dict__.setdefault("_rights", {})
    if school.id in cache:
        return cache[school.id]
    db = db or object_session(user)
    have = _computed(db, user, school)
    actor: User | None = user.__dict__.get("acting_by")
    if actor:
        mine = _computed(db, actor, school)
        have = {r for r in have & mine if r.endswith(".see")}
    cache[school.id] = have
    return have


def has(user: User, school: School, right: str, db: Session | None = None) -> bool:
    return right in rights_of(user, school, db)


def by_grant(user: User, school: School, right: str) -> bool:
    """True when this right comes only from a temporary access grant (so its use is reported to the principal)."""
    rights_of(user, school)
    return right in user.__dict__.get("_granted", {}).get(school.id, set())


def may(user: User, school: School, area: str | None = None, level: str | None = None) -> bool:
    """The check behind every 'runs this school' test. Without a web request (scripts), fall back to roles."""
    need = route_need(user)
    if area is None:
        if need is None:
            return owns(user, school) or bool(roles_at(user, school) & {"head_of_school", "head", "vice_principal", "it_admin"})
        area, lvl = need
        level = level or lvl
    if level is None:
        # Same as the page being used: reading needs "see", saving needs "change".
        level = need[1] if need else "see"
    if AREAS.get(area, {}).get("change_only"):
        level = "change"
    return f"{area}.{level}" in rights_of(user, school)


def any_area(user: User, school: School) -> bool:
    """May open the school's pages at all."""
    return any(r.endswith(".see") and r.split(".")[0] in AREAS for r in rights_of(user, school))


def acting(user: User) -> User | None:
    return user.__dict__.get("acting_by")


def school_ids_with_rights(db: Session, user: User) -> dict[uuid.UUID, School]:
    ids = {m.school_id for m in user.memberships if m.school_id}
    groups = {m.group_id for m in user.memberships if m.role == Role.owner}
    q = select(School).where((School.id.in_(ids or {uuid.uuid4()})) | (School.group_id.in_(groups or {uuid.uuid4()})))
    return {s.id: s for s in db.scalars(q)}


def school_roles_users(db: Session, school_id: uuid.UUID, roles: set[str]) -> set[uuid.UUID]:
    return set(db.scalars(select(Membership.user_id).where(Membership.school_id == school_id,
                                                           Membership.role.in_([Role(r) for r in roles]))))


# ---------- Private records ----------

PRIVATE_SENTENCE = {"health": "medical records", "safeguarding": "incident and safeguarding records", "staff_pay": "staff pay and bank details"}


def notify_heads(db: Session, school: School, text: str, kind: str = "private", icon: str = "shield", link: str | None = None,
                 skip: uuid.UUID | None = None) -> None:
    """A notice for the principal and the head of school (and the owner if the school has neither)."""
    from app.models import Notice
    ids = school_roles_users(db, school.id, {"head", "head_of_school"})
    if not ids:
        ids = set(db.scalars(select(Membership.user_id).where(Membership.group_id == school.group_id, Membership.role == Role.owner)))
    for uid in ids - {skip}:
        db.add(Notice(user_id=uid, school_id=school.id, kind=kind, icon=icon, text=text[:400], link=link))


def use_private(db: Session, user: User, school: School, kind: str, what: str = "") -> bool:
    """May this person open (or, when saving, change) private records of this kind?
    Never while seeing as someone else. When the access comes from a temporary grant, the principal is told."""
    if acting(user):
        return False
    right = f"private.{kind}"
    if not has(user, school, right, db):
        return False
    if by_grant(user, school, right):
        from app.models import AuditEntry
        writing = is_writing(user)
        today = datetime.now(timezone.utc).date().isoformat()
        key = f"{user.id}:{kind}:{'w:' + uuid.uuid4().hex if writing else 'r:' + today}"
        if writing or not db.scalar(select(AuditEntry.id).where(AuditEntry.key == key)):
            verb = "changed" if writing else "opened"
            label = PRIVATE_SENTENCE.get(kind, kind)
            db.add(AuditEntry(school_id=school.id, actor_id=user.id, action="private_change" if writing else "private_open",
                              what=f"{verb} {label}{': ' + what if what else ''}", key=key))
            notify_heads(db, school, f"{user.full_name} {verb} {label}{' (' + what + ')' if what else ''} using the access you approved.",
                         link=f"#/school/{school.id}/rights")
            db.commit()
    return True
