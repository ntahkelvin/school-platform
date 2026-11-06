"""Discipline: how a report about a student's behaviour travels and what is done about it.

The way most Nigerian secondary schools run it:
1. Any staff member reports (and students can tell the POD something, in confidence).
2. Boarding offences go to the house master first (a school setting), who adds what they found and passes it on.
3. The principal of discipline (POD) looks into every report: takes statements, then either drops it (not proven),
   deals with a minor offence (if the school allows), or sends it to the principal with a recommendation.
4. The principal decides: counselling, a punishment from the school's list, demerit points, detention, inviting
   the parents, discipline probation, suspension, or expulsion. Several at once.
5. The ladder: demerit points this term lead to detention, then to discipline probation (school settings),
   so a case opens by itself when a student crosses a line.
6. Families see what the school chooses: every decision, only the serious ones, or only letters.
   They never see who reported, statements, or the POD's notes.
"""
import secrets
import uuid
from collections import defaultdict
from datetime import date, datetime, time, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.access import not_found
from app.api.deps import current_user
from app.api.family import child_for
from app.api.student360 import name_of
from app.core import rights
from app.core.db import get_db
from app.models import (
    AcademicSession, Bed, ConductEntry, DisciplineCase, DisciplineSettings, Hostel, House, Membership, Role, School, SchoolClass, Student, Term, User,
)

router = APIRouter(prefix="/api", tags=["discipline"])

OFFENCES = [
    # minor
    ("late", "Lateness", "minor", 1, False), ("uniform", "Improper uniform or hair", "minor", 1, False), ("noise", "Noise making", "minor", 1, False),
    ("homework", "No homework or assignment", "minor", 1, False), ("litter", "Littering", "minor", 1, False),
    ("out_of_class", "Out of class without permission", "minor", 2, False), ("lights_out", "Talking after lights out", "minor", 2, True),
    ("inspection", "Untidy bed or locker at inspection", "minor", 1, True), ("bounds", "Out of bounds", "minor", 3, True),
    # major
    ("disrespect", "Disrespect to a staff member", "major", 4, False), ("fighting", "Fighting", "major", 5, False),
    ("phone", "Phone or banned item", "major", 4, False), ("truancy", "Truancy or leaving school without permission", "major", 5, False),
    ("bullying", "Bullying", "major", 6, False), ("damage", "Damage to school property", "major", 4, False),
    ("malpractice", "Exam malpractice", "major", 6, False), ("food_theft", "Taking another student's provisions", "major", 4, True),
    # severe
    ("stealing", "Stealing", "severe", 8, False), ("drugs", "Drugs, alcohol or smoking", "severe", 10, False),
    ("assault", "Assault or serious fighting", "severe", 10, False), ("escape", "Sneaking out of school at night", "severe", 8, True),
    ("cult", "Cult activity", "severe", 10, False), ("gross", "Gross misconduct", "severe", 10, False),
]
PUNISHMENTS = [("apology", "Letter of apology"), ("lines", "Writing lines"), ("manual", "Manual work on the school compound"),
               ("litter_pick", "Picking litter"), ("privileges", "Loss of privileges (outing, visiting day, TV)"), ("restitution", "Paying for or replacing what was damaged")]
KINDS = {
    "counselling": "Counselling", "warning": "Warning", "punishment": "Punishment", "demerit": "Demerit points", "detention": "Detention",
    "invite_parents": "Parents invited to school", "probation": "Discipline probation", "suspension": "Suspension", "expulsion": "Expulsion",
}
SERIOUS = {"detention", "invite_parents", "probation", "suspension", "expulsion"}
MINOR_KINDS = {"counselling", "warning", "punishment", "demerit"}       # what the POD may do alone, for minor offences
STAGES = {"tip": "Told by a student", "house": "With the house master", "pod": "With the POD", "principal": "With the principal",
          "decided": "Decided", "closed": "Closed", "dismissed": "Dropped"}
OPEN = ("tip", "house", "pod", "principal")


def now() -> datetime:
    return datetime.now(timezone.utc)


def settings(db: Session, school_id: uuid.UUID) -> DisciplineSettings:
    st = db.scalar(select(DisciplineSettings).where(DisciplineSettings.school_id == school_id))
    if not st:
        st = DisciplineSettings(school_id=school_id, pod_user_ids=[], parents_see="all", boarding_first=True, pod_settles_minor=True,
                                offences=[{"key": k, "name": n, "level": lv, "points": p, "boarding": b} for k, n, lv, p, b in OFFENCES],
                                punishments=[{"key": k, "name": n} for k, n in PUNISHMENTS], ladder={"detention": 10, "probation": 20})
    return st


def pods(db: Session, school: School, st: DisciplineSettings | None = None) -> set[uuid.UUID]:
    st = st or settings(db, school.id)
    ids = {uuid.UUID(x) for x in st.pod_user_ids or []}
    return ids or rights.school_roles_users(db, school.id, {"vice_principal"})


def deciders(db: Session, school: School) -> set[uuid.UUID]:
    ids = rights.school_roles_users(db, school.id, {"head", "head_of_school"})
    return ids or set(db.scalars(select(Membership.user_id).where(Membership.group_id == school.group_id, Membership.role == Role.owner)))


def is_pod(db: Session, user: User, school: School) -> bool:
    return user.id in pods(db, school) and not rights.acting(user)


def may_decide(db: Session, user: User, school: School) -> bool:
    return rights.has(user, school, "power.decide_discipline", db) and not rights.acting(user)


def may_run(db: Session, user: User, school: School) -> bool:
    return is_pod(db, user, school) or may_decide(db, user, school) or (rights.has(user, school, "discipline.change", db) and not rights.acting(user))


def may_see_all(db: Session, user: User, school: School) -> bool:
    return may_run(db, user, school) or rights.has(user, school, "discipline.see", db)


def is_staff(user: User, school: School) -> bool:
    return bool(rights.roles_at(user, school)) or rights.owns(user, school)


def house_master(db: Session, s: Student) -> uuid.UUID | None:
    bed = db.scalar(select(Bed).where(Bed.student_id == s.id))
    hs = db.get(Hostel, bed.hostel_id) if bed else None
    if hs and hs.house_parent_user_id:
        return hs.house_parent_user_id
    h = db.get(House, s.house_id) if s.house_id else None
    return h.master_user_id if h else None


def family_ids(s: Student) -> set:
    return ({s.user_id} if s.user_id else set()) | {g.user_id for g in s.guardians}


def notify(db: Session, ids, school_id, text: str, link: str | None, icon: str = "gavel", kind: str = "info") -> None:
    from app.api.assessment import notify as _n
    _n(db, ids, school_id, text, link, icon, kind)


def log(case: DisciplineCase, who: str, what: str) -> None:
    case.history = [*(case.history or []), {"at": now().isoformat(), "by": who, "action": what}]


def next_number(db: Session, school_id: uuid.UUID) -> int:
    return (db.scalar(select(func.max(DisciplineCase.number)).where(DisciplineCase.school_id == school_id)) or 0) + 1


def term_start(db: Session, school_id: uuid.UUID) -> datetime:
    t = db.scalar(select(Term).join(AcademicSession, AcademicSession.id == Term.session_id).where(AcademicSession.school_id == school_id, Term.is_current.is_(True)))
    d = t.starts_on if t and t.starts_on else (now() - timedelta(days=90)).date()
    return datetime.combine(d, time.min, tzinfo=timezone.utc)


def demerits_this_term(db: Session, s: Student) -> int:
    return -(db.scalar(select(func.sum(ConductEntry.points)).where(ConductEntry.student_id == s.id, ConductEntry.points < 0,
                                                                    ConductEntry.created_at >= term_start(db, s.school_id))) or 0)


def visible_to_family(case: DisciplineCase, st: DisciplineSettings) -> list[dict]:
    """The actions families may see under the school's rule; empty means the case is not shown."""
    if case.status not in ("decided", "closed") or not case.student_id:
        return []
    acts = case.actions or []
    if st.parents_see == "all":
        return acts
    if st.parents_see == "serious":
        return [a for a in acts if a["kind"] in SERIOUS]
    return [a for a in acts if a["kind"] in ("invite_parents", "suspension", "expulsion")]       # "letters"


# ---------- The ladder ----------

def ladder_check(db: Session, s: Student, who: str = "System") -> DisciplineCase | None:
    """Demerit points this term -> detention -> discipline probation: open a case when a line is crossed (once each per term)."""
    school = db.get(School, s.school_id)
    st = settings(db, school.id)
    pts = demerits_this_term(db, s)
    lad = st.ladder or {}
    since = term_start(db, school.id)
    made = None
    for step, line in (("detention", lad.get("detention")), ("probation", lad.get("probation"))):
        if not line or pts < line:
            continue
        key = f"ladder_{step}"
        if db.scalar(select(DisciplineCase.id).where(DisciplineCase.student_id == s.id, DisciplineCase.offence == key, DisciplineCase.created_at >= since)):
            continue
        c = db.get(SchoolClass, s.class_id) if s.class_id else None
        case = DisciplineCase(id=uuid.uuid4(), school_id=school.id, number=next_number(db, school.id), student_id=s.id, offence=key,
                              offence_name=f"Reached {line} demerit points this term ({pts} now)", level="minor" if step == "detention" else "major",
                              occurred_at=now(), details=f"{s.full_name} has {pts} demerit points this term. The school's rule: {line} points means "
                              + ("detention." if step == "detention" else "discipline probation."),
                              reporter_kind="system", status="pod" if step == "detention" else "principal", statements=[], actions=[], history=[],
                              recommendation=None if step == "detention" else f"Discipline probation for {s.first_name} ({pts} demerit points this term).")
        db.add(case)
        db.flush()
        log(case, who, f"Opened by the ladder: {pts} demerit points")
        to = pods(db, school, st) if step == "detention" else deciders(db, school) | pods(db, school, st)
        notify(db, to, school.id, f"Discipline: {s.full_name} ({c.name if c else ''}) has {pts} demerit points this term — "
               + ("detention is due." if step == "detention" else "discipline probation is due."), f"#/discipline-case/{case.id}", "gavel", "request")
        if c and c.form_teacher_id:
            notify(db, {c.form_teacher_id}, school.id, f"{s.full_name} has {pts} demerit points this term. The POD has been told.", f"#/student/{s.id}")
        made = case
    return made


# ---------- Settings ----------

def settings_out(db: Session, st: DisciplineSettings, school: School) -> dict:
    return {"pods": [{"id": str(u), "name": name_of(db, u)} for u in pods(db, school, st)], "pods_chosen": bool(st.pod_user_ids),
            "offences": st.offences, "punishments": st.punishments, "ladder": {"detention": 10, "probation": 20, **(st.ladder or {})},
            "parents_see": st.parents_see, "boarding_first": st.boarding_first, "pod_settles_minor": st.pod_settles_minor,
            "kinds": KINDS, "stages": STAGES}


@router.get("/schools/{school_id}/discipline/settings")
def get_settings(school_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    school = db.get(School, school_id)
    if not school or not is_staff(user, school):
        raise not_found("School")
    st = settings(db, school.id)
    return {**settings_out(db, st, school), "can_change": may_decide(db, user, school) or rights.has(user, school, "discipline.change", db),
            "can_run": may_run(db, user, school), "can_decide": may_decide(db, user, school), "is_pod": is_pod(db, user, school)}


class OffenceIn(BaseModel):
    key: str | None = Field(default=None, max_length=40)
    name: str = Field(min_length=2, max_length=120)
    level: str = Field(pattern="^(minor|major|severe)$")
    points: int = Field(ge=0, le=50)
    boarding: bool = False


class NamedIn(BaseModel):
    key: str | None = Field(default=None, max_length=40)
    name: str = Field(min_length=2, max_length=120)


class SettingsIn(BaseModel):
    pod_user_ids: list[uuid.UUID] | None = Field(default=None, max_length=6)
    offences: list[OffenceIn] | None = Field(default=None, max_length=80)
    punishments: list[NamedIn] | None = Field(default=None, max_length=40)
    ladder: dict[str, int] | None = None
    parents_see: str | None = Field(default=None, pattern="^(all|serious|letters)$")
    boarding_first: bool | None = None
    pod_settles_minor: bool | None = None


def keyed(rows, existing) -> list[dict]:
    used, out = set(), []
    for r in rows:
        d = r.model_dump()
        k = d.get("key") or "".join(ch if ch.isalnum() else "_" for ch in d["name"].lower())[:30].strip("_")
        while k in used:
            k += "_"
        used.add(k)
        out.append({**d, "key": k})
    return out


@router.put("/schools/{school_id}/discipline/settings")
def put_settings(school_id: uuid.UUID, data: SettingsIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    school = db.get(School, school_id)
    if not school or not (may_decide(db, user, school) or (rights.has(user, school, "discipline.change", db) and not rights.acting(user))):
        raise not_found("School")
    st = settings(db, school.id)
    if data.pod_user_ids is not None:
        staff = {m.user_id for m in db.scalars(select(Membership).where(Membership.school_id == school.id))}
        if any(u not in staff for u in data.pod_user_ids):
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Choose staff of this school")
        st.pod_user_ids = [str(u) for u in data.pod_user_ids]
    if data.offences is not None:
        st.offences = keyed(data.offences, st.offences)
    if data.punishments is not None:
        st.punishments = keyed(data.punishments, st.punishments)
    if data.ladder is not None:
        lad = {k: max(0, min(200, int(v))) for k, v in data.ladder.items() if k in ("detention", "probation")}
        if lad.get("detention") and lad.get("probation") and lad["probation"] <= lad["detention"]:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Probation needs more points than detention")
        st.ladder = lad
    for k in ("parents_see", "boarding_first", "pod_settles_minor"):
        if getattr(data, k) is not None:
            setattr(st, k, getattr(data, k))
    db.add(st)
    db.commit()
    return get_settings(school_id, user, db)


# ---------- Reporting ----------

class ReportIn(BaseModel):
    student_ids: list[uuid.UUID] = Field(min_length=1, max_length=15)
    offence: str = Field(min_length=1, max_length=40)
    occurred_at: datetime | None = None
    place: str | None = Field(default=None, max_length=120)
    details: str = Field(min_length=5, max_length=4000)


@router.post("/schools/{school_id}/discipline/reports", status_code=201)
def report(school_id: uuid.UUID, data: ReportIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Any staff member reports a student (or several, from the same thing)."""
    school = db.get(School, school_id)
    if not school or not is_staff(user, school) or rights.acting(user):
        raise not_found("School")
    st = settings(db, school.id)
    off = next((o for o in st.offences if o["key"] == data.offence), None)
    if not off:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Choose the offence from the list")
    group = secrets.token_hex(4) if len(data.student_ids) > 1 else None
    who = name_of(db, user.id)
    made = []
    for sid in dict.fromkeys(data.student_ids):
        s = db.get(Student, sid)
        if not s or s.school_id != school.id:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "A student is not in this school")
        hm = house_master(db, s) if off.get("boarding") and st.boarding_first else None
        stage = "house" if hm and hm != user.id else "pod"
        case = DisciplineCase(id=uuid.uuid4(), school_id=school.id, number=next_number(db, school.id), student_id=s.id, group=group, offence=off["key"],
                              offence_name=off["name"], level=off["level"], occurred_at=data.occurred_at or now(), place=data.place, details=data.details,
                              reported_by_id=user.id, reporter_kind="staff", status=stage, statements=[], actions=[], history=[])
        db.add(case)
        db.flush()
        log(case, who, "Reported" + (" (goes to the house master first)" if stage == "house" else ""))
        c = db.get(SchoolClass, s.class_id) if s.class_id else None
        to = {hm} if stage == "house" else pods(db, school, st)
        notify(db, to - {user.id}, school.id, f"Discipline report #{case.number}: {s.full_name} ({c.name if c else ''}) — {off['name']}. Reported by {who}.",
               f"#/discipline-case/{case.id}", "gavel", "request")
        if off["level"] == "severe":
            notify(db, deciders(db, school) - {user.id}, school.id, f"Serious discipline report #{case.number}: {s.full_name} — {off['name']}. The POD is looking into it.",
                   f"#/discipline-case/{case.id}", "gavel")
        made.append(case)
    db.commit()
    return {"cases": [case_out(db, x, user, school, full=False) for x in made]}


class TipIn(BaseModel):
    about: str = Field(min_length=2, max_length=200)
    what: str = Field(min_length=5, max_length=3000)
    place: str | None = Field(default=None, max_length=120)
    when: datetime | None = None


@router.post("/me/children/{student_id}/discipline-tip", status_code=201)
def tip(student_id: uuid.UUID, data: TipIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """A student tells the POD about something they saw. Only the POD and the principal know who told."""
    s, rel = child_for(db, user, student_id)
    if rel != "self":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Students send this from their own login")
    school = db.get(School, s.school_id)
    case = DisciplineCase(id=uuid.uuid4(), school_id=school.id, number=next_number(db, school.id), student_id=None, about=data.about.strip(), offence="tip",
                          offence_name="Told by a student", level="minor", occurred_at=data.when or now(), place=data.place, details=data.what.strip(),
                          reported_by_id=user.id, reporter_kind="student", status="tip", statements=[], actions=[], history=[])
    db.add(case)
    db.flush()
    log(case, "A student", "Told the POD in confidence")
    notify(db, pods(db, school), school.id, f"A student told the POD something (#{case.number}): about {data.about.strip()[:80]}.", f"#/discipline-case/{case.id}", "gavel", "request")
    db.commit()
    return {"ok": True, "number": case.number, "message": "Thank you. Only the principal of discipline and the principal will know you told them."}


# ---------- Reading ----------

def role_in(db: Session, user: User, case: DisciplineCase, school: School) -> str | None:
    """How this person relates to the case: run (POD, principal, discipline right), house (house master on it),
    reporter (staff who reported it), form (form teacher, once decided)."""
    if may_run(db, user, school) or rights.has(user, school, "discipline.see", db):
        return "run"
    s = db.get(Student, case.student_id) if case.student_id else None
    if s and house_master(db, s) == user.id and (case.status == "house" or any("house master" in (h.get("action") or "") for h in case.history or [])):
        return "house"
    if case.reported_by_id == user.id and case.reporter_kind == "staff":
        return "reporter"
    c = db.get(SchoolClass, s.class_id) if s and s.class_id else None
    if c and c.form_teacher_id == user.id and case.status in ("decided", "closed"):
        return "form"
    return None


def case_out(db: Session, case: DisciplineCase, user: User, school: School, full: bool = True, role: str | None = None) -> dict:
    s = db.get(Student, case.student_id) if case.student_id else None
    c = db.get(SchoolClass, s.class_id) if s and s.class_id else None
    role = role or role_in(db, user, case, school)
    inner = role in ("run", "house")
    out = {"id": str(case.id), "number": case.number, "status": case.status, "stage": STAGES.get(case.status, case.status), "level": case.level,
           "offence": case.offence, "offence_name": case.offence_name, "occurred_at": case.occurred_at.isoformat(), "place": case.place,
           "student": {"id": str(s.id), "name": s.full_name, "first_name": s.first_name, "thumb": s.photo_thumb, "class_name": c.name if c else None,
                       "admission_no": s.admission_no} if s else None, "about": case.about,
           "reported_at": case.created_at.isoformat() if case.created_at else None, "reporter_kind": case.reporter_kind,
           "reporter": (name_of(db, case.reported_by_id) if case.reporter_kind == "staff" or role == "run" else None) if inner or role == "reporter" else None,
           "decision": case.decision if case.status in ("decided", "closed") else None,
           "actions": (case.actions or []) if (case.status in ("decided", "closed") or inner) else [],
           "group": case.group, "role": role}
    if full and inner:
        others = [{"id": str(x.id), "number": x.number, "student": db.get(Student, x.student_id).full_name if x.student_id else None, "status": x.status}
                  for x in db.scalars(select(DisciplineCase).where(DisciplineCase.group == case.group, DisciplineCase.id != case.id))] if case.group else []
        earlier = [{"id": str(x.id), "number": x.number, "offence_name": x.offence_name, "status": x.status, "at": x.occurred_at.isoformat(),
                    "actions": [KINDS.get(a["kind"], a["kind"]) for a in x.actions or []]}
                   for x in db.scalars(select(DisciplineCase).where(DisciplineCase.student_id == case.student_id, DisciplineCase.id != case.id)
                                       .order_by(DisciplineCase.occurred_at.desc()).limit(20))] if s else []
        out.update({"details": case.details, "statements": case.statements or [], "recommendation": case.recommendation, "history": case.history or [],
                    "decided_by": name_of(db, case.decided_by_id), "decided_at": case.decided_at.isoformat() if case.decided_at else None,
                    "parent_seen_at": case.parent_seen_at.isoformat() if case.parent_seen_at else None, "parent_reply": case.parent_reply,
                    "others": others, "earlier": earlier, "demerits_this_term": demerits_this_term(db, s) if s else None,
                    "house_master": name_of(db, house_master(db, s)) if s else None,
                    "house_master_id": str(house_master(db, s)) if s and house_master(db, s) else None})
    elif full:
        out.update({"details": case.details if role == "reporter" else None, "history": []})
    return out


def get_case(db: Session, user: User, cid: uuid.UUID) -> tuple[DisciplineCase, School, str]:
    case = db.get(DisciplineCase, cid)
    school = db.get(School, case.school_id) if case else None
    role = role_in(db, user, case, school) if case else None
    if not role:
        raise not_found("Case")
    return case, school, role


@router.get("/schools/{school_id}/discipline")
def list_cases(school_id: uuid.UUID, view: str = "inbox", user: User = Depends(current_user), db: Session = Depends(get_db)):
    """inbox: waiting for me; open; decided; all; detention (who has detention, by day); active (on probation or suspended now)."""
    school = db.get(School, school_id)
    if not school or not is_staff(user, school):
        raise not_found("School")
    st = settings(db, school.id)
    run, pod, decide = may_see_all(db, user, school), is_pod(db, user, school), may_decide(db, user, school)
    rows = list(db.scalars(select(DisciplineCase).where(DisciplineCase.school_id == school.id).order_by(DisciplineCase.created_at.desc()).limit(1500)))
    mine_house = [x for x in rows if x.status == "house" and x.student_id and house_master(db, db.get(Student, x.student_id)) == user.id]
    if not run:
        rows = [x for x in rows if role_in(db, user, x, school)]

    def waiting(x):
        return (x.status in ("tip", "pod") and pod) or (x.status == "principal" and decide) or x in mine_house
    counts = {"inbox": sum(1 for x in rows if waiting(x)), "open": sum(1 for x in rows if x.status in OPEN),
              "decided": sum(1 for x in rows if x.status == "decided"), "all": len(rows)}
    today = date.today()
    if view == "detention" or view == "active":
        items = []
        for x in rows:
            for a in x.actions or []:
                if view == "detention" and a["kind"] == "detention" and a.get("on") and a["on"] >= (today - timedelta(days=7)).isoformat():
                    items.append((a["on"], x, a))
                if view == "active" and a["kind"] in ("probation", "suspension") and (a.get("until") or "9999") >= today.isoformat() and not a.get("done"):
                    items.append((a.get("on") or "", x, a))
        items.sort(key=lambda t: t[0])
        out = [{"action": a, "case": case_out(db, x, user, school, full=False)} for _, x, a in items]
        return {"view": view, "items": out, "counts": counts, "can_run": may_run(db, user, school), "today": today.isoformat()}
    pick = {"inbox": waiting, "open": lambda x: x.status in OPEN, "decided": lambda x: x.status == "decided", "all": lambda x: True}.get(view, waiting)
    cases = [case_out(db, x, user, school, full=False) for x in rows if pick(x)][:300]
    return {"view": view, "cases": cases, "counts": counts, "can_run": may_run(db, user, school), "is_pod": pod, "can_decide": decide,
            "pods": [name_of(db, u) for u in pods(db, school, st)]}


@router.get("/discipline/{cid}")
def one(cid: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    case, school, role = get_case(db, user, cid)
    st = settings(db, school.id)
    pod, decide = is_pod(db, user, school), may_decide(db, user, school)
    open_ = case.status in OPEN
    return {**case_out(db, case, user, school, role=role), "settings": {"punishments": st.punishments, "kinds": KINDS, "parents_see": st.parents_see,
                                                                         "pod_settles_minor": st.pod_settles_minor},
            "can": {"statement": open_ and role in ("run", "house"),
                    "forward_pod": case.status == "house" and role in ("run", "house"),
                    "forward_principal": case.status in ("pod", "house") and (pod or decide),
                    "dismiss": case.status in ("pod", "principal", "house", "tip") and (pod or decide),
                    "decide": (case.status in ("pod", "principal", "house") and decide)
                              or (case.status == "pod" and pod and st.pod_settles_minor and case.level == "minor"),
                    "pod_only_minor": not decide,
                    "link": case.status == "tip" and (pod or decide),
                    "act": case.status == "decided" and (pod or decide or rights.has(user, school, "discipline.change", db)),
                    "close": case.status == "decided" and (pod or decide)},
            "school": {"id": str(school.id), "name": school.name, "logo": school.logo, "address": school.address, "phone": school.phone, "motto": school.motto}}


# ---------- Working a case ----------

class StatementIn(BaseModel):
    who: str = Field(min_length=2, max_length=120)          # whose words: "the student", "class captain", a teacher...
    text: str = Field(min_length=3, max_length=4000)


@router.post("/discipline/{cid}/statements")
def add_statement(cid: uuid.UUID, data: StatementIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    case, school, role = get_case(db, user, cid)
    if role not in ("run", "house") or case.status not in OPEN or rights.acting(user):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the POD, the principal or the house master add statements")
    case.statements = [*(case.statements or []), {"id": secrets.token_hex(4), "who": data.who.strip(), "text": data.text.strip(), "at": now().isoformat(),
                                                  "by": name_of(db, user.id)}]
    log(case, name_of(db, user.id), f"Took a statement from {data.who.strip()}")
    db.commit()
    return one(cid, user, db)


class ForwardIn(BaseModel):
    to: str = Field(pattern="^(pod|principal)$")
    recommendation: str | None = Field(default=None, max_length=3000)


@router.post("/discipline/{cid}/forward")
def forward(cid: uuid.UUID, data: ForwardIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    case, school, role = get_case(db, user, cid)
    info = one(cid, user, db)["can"]
    who = name_of(db, user.id)
    s = db.get(Student, case.student_id)
    if data.to == "pod":
        if not info["forward_pod"]:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "This case is not with the house master")
        case.status = "pod"
        if data.recommendation:
            case.statements = [*(case.statements or []), {"id": secrets.token_hex(4), "who": "House master's note", "text": data.recommendation.strip(),
                                                          "at": now().isoformat(), "by": who}]
        log(case, who, "Passed to the POD")
        notify(db, pods(db, school) - {user.id}, school.id, f"Discipline #{case.number}: {s.full_name} — {case.offence_name}. Passed on by the house master ({who}).",
               f"#/discipline-case/{case.id}", "gavel", "request")
    else:
        if not info["forward_principal"]:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the POD sends a case to the principal")
        if not (data.recommendation or "").strip():
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Write what you found and what you recommend")
        case.status, case.recommendation = "principal", data.recommendation.strip()
        log(case, who, "Sent to the principal with a recommendation")
        notify(db, deciders(db, school) - {user.id}, school.id, f"Discipline #{case.number} needs your decision: {s.full_name} — {case.offence_name}.",
               f"#/discipline-case/{case.id}", "gavel", "request")
    db.commit()
    return one(cid, user, db)


class DismissIn(BaseModel):
    reason: str = Field(min_length=3, max_length=1000)


@router.post("/discipline/{cid}/dismiss")
def dismiss(cid: uuid.UUID, data: DismissIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    case, school, _ = get_case(db, user, cid)
    if not one(cid, user, db)["can"]["dismiss"]:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the POD or the principal can drop a case")
    case.status, case.decision = "dismissed", data.reason.strip()
    log(case, name_of(db, user.id), f"Dropped: {data.reason.strip()}")
    if case.reported_by_id and case.reporter_kind == "staff" and case.reported_by_id != user.id:
        notify(db, {case.reported_by_id}, school.id, f"Your discipline report #{case.number} was looked into and dropped: {data.reason.strip()[:150]}", f"#/discipline-case/{case.id}")
    db.commit()
    return one(cid, user, db)


class LinkIn(BaseModel):
    student_ids: list[uuid.UUID] = Field(min_length=1, max_length=15)
    offence: str = Field(min_length=1, max_length=40)


@router.post("/discipline/{cid}/link")
def link_tip(cid: uuid.UUID, data: LinkIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """The POD turns a student's tip into a case for each student it is about. The student who told stays hidden."""
    case, school, _ = get_case(db, user, cid)
    if not one(cid, user, db)["can"]["link"]:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the POD can open cases from a tip")
    st = settings(db, school.id)
    off = next((o for o in st.offences if o["key"] == data.offence), None)
    if not off:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Choose the offence from the list")
    group = secrets.token_hex(4)
    made = []
    for sid in dict.fromkeys(data.student_ids):
        s = db.get(Student, sid)
        if not s or s.school_id != school.id:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "A student is not in this school")
        x = DisciplineCase(id=uuid.uuid4(), school_id=school.id, number=next_number(db, school.id), student_id=s.id, group=group, offence=off["key"],
                           offence_name=off["name"], level=off["level"], occurred_at=case.occurred_at, place=case.place, details=case.details,
                           reported_by_id=user.id, reporter_kind="staff", status="pod", statements=[], actions=[], history=[])
        db.add(x)
        db.flush()
        log(x, name_of(db, user.id), f"Opened from a student's tip (#{case.number})")
        made.append(x)
    case.status, case.group = "closed", group
    log(case, name_of(db, user.id), f"Opened {len(made)} case(s) from this tip")
    db.commit()
    return {"cases": [str(x.id) for x in made]}


class ActionIn(BaseModel):
    kind: str
    name: str | None = Field(default=None, max_length=120)     # the punishment, or what kind of counselling
    points: int | None = Field(default=None, ge=1, le=50)
    on: date | None = None                                     # detention day, start of probation or suspension, invitation day
    until: date | None = None
    at: str | None = Field(default=None, max_length=10)         # time: "14:00"
    note: str | None = Field(default=None, max_length=500)
    in_school: bool | None = None                              # suspension served in school


class DecideIn(BaseModel):
    decision: str = Field(min_length=3, max_length=3000)
    actions: list[ActionIn] = Field(min_length=1, max_length=8)


def check_action(a: ActionIn) -> dict:
    if a.kind not in KINDS:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Choose what will be done")
    label = KINDS[a.kind]
    if a.kind == "punishment" and not a.name:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Choose the punishment")
    if a.kind == "demerit" and not a.points:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "How many demerit points?")
    if a.kind in ("detention", "invite_parents", "probation", "suspension") and not a.on:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"{label}: choose the date")
    if a.kind in ("probation", "suspension") and (not a.until or a.until < a.on):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"{label}: choose when it ends (after it starts)")
    return {"id": secrets.token_hex(4), "kind": a.kind, "label": label, "name": a.name, "points": a.points, "on": a.on.isoformat() if a.on else None,
            "until": a.until.isoformat() if a.until else None, "at": a.at, "note": a.note, "in_school": a.in_school, "done": None}


def say(a: dict) -> str:
    d = lambda x: datetime.fromisoformat(x).strftime("%a %d %b") if x else ""
    k = a["kind"]
    if k == "punishment":
        return a["name"]
    if k == "demerit":
        return f"{a['points']} demerit points"
    if k == "detention":
        return f"Detention on {d(a['on'])}" + (f" at {a['at']}" if a.get("at") else "")
    if k == "invite_parents":
        return f"Parents invited to school on {d(a['on'])}" + (f" at {a['at']}" if a.get("at") else "")
    if k in ("probation", "suspension"):
        return f"{a['label']}{' (in school)' if a.get('in_school') else ''} from {d(a['on'])} to {d(a['until'])}"
    return a["label"] + (f": {a['name']}" if a.get("name") else "")


@router.post("/discipline/{cid}/decide")
def decide(cid: uuid.UUID, data: DecideIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    case, school, _ = get_case(db, user, cid)
    can = one(cid, user, db)["can"]
    if not can["decide"]:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the principal decides (the POD may deal with minor offences if the school allows)")
    acts = [check_action(a) for a in data.actions]
    if can["pod_only_minor"] and any(a["kind"] not in MINOR_KINDS for a in acts):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "The POD can give counselling, a warning, a punishment or demerit points. Send the rest to the principal.")
    st = settings(db, school.id)
    s = db.get(Student, case.student_id)
    c = db.get(SchoolClass, s.class_id) if s.class_id else None
    who = name_of(db, user.id)
    case.status, case.decision, case.actions, case.decided_by_id, case.decided_at = "decided", data.decision.strip(), acts, user.id, now()
    log(case, who, "Decided: " + "; ".join(say(a) for a in acts))
    for a in acts:
        if a["kind"] == "demerit":
            db.add(ConductEntry(school_id=s.school_id, student_id=s.id, house_id=s.house_id, kind="demerit", category="discipline", points=-a["points"],
                                note=f"Case #{case.number}: {case.offence_name}"[:300], by_id=user.id))
    link = f"#/discipline-case/{case.id}"
    summary = "; ".join(say(a) for a in acts)
    team = pods(db, school, st) | ({c.form_teacher_id} if c and c.form_teacher_id else set())
    if any(a["kind"] in ("suspension", "expulsion", "probation") for a in acts):
        team |= {house_master(db, s)} | deciders(db, school)
    notify(db, team - {user.id}, school.id, f"Discipline #{case.number} decided: {s.full_name} ({c.name if c else ''}) — {summary}.", link, "gavel")
    if case.reported_by_id and case.reporter_kind == "staff" and case.reported_by_id != user.id:
        notify(db, {case.reported_by_id}, school.id, f"Your report #{case.number} about {s.full_name} has been dealt with.", link)
    shown = visible_to_family(case, st)
    if shown:
        notify(db, family_ids(s), school.id, f"A message from the school about {s.first_name}'s conduct: " + "; ".join(say(a) for a in shown) + ". Please read it.",
               f"#/child/{s.id}", "gavel", "request")
    db.flush()
    if any(a["kind"] == "demerit" for a in acts):
        ladder_check(db, s, who)
    db.commit()
    return one(cid, user, db)


@router.post("/discipline/{cid}/actions/{aid}/done")
def action_done(cid: uuid.UUID, aid: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    case, school, _ = get_case(db, user, cid)
    if not one(cid, user, db)["can"]["act"]:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the POD or the principal mark this")
    acts = [dict(a) for a in case.actions or []]
    for a in acts:
        if a["id"] == aid:
            a["done"] = None if a.get("done") else now().isoformat()
            log(case, name_of(db, user.id), ("Done: " if a["done"] else "Not done: ") + say(a))
    case.actions = acts
    db.commit()
    return one(cid, user, db)


@router.post("/discipline/{cid}/close")
def close(cid: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    case, school, _ = get_case(db, user, cid)
    if not one(cid, user, db)["can"]["close"]:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the POD or the principal close a case")
    case.status = "closed"
    log(case, name_of(db, user.id), "Closed")
    db.commit()
    return one(cid, user, db)


# ---------- A student's record, the home card ----------

@router.get("/students/{student_id}/discipline")
def student_record(student_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    s = db.get(Student, student_id)
    if not s:
        raise not_found("Student")
    school = db.get(School, s.school_id)
    if not is_staff(user, school):
        raise not_found("Student")
    today = date.today().isoformat()
    rows = list(db.scalars(select(DisciplineCase).where(DisciplineCase.student_id == s.id).order_by(DisciplineCase.occurred_at.desc())))
    cases = [case_out(db, x, user, school, full=False) for x in rows if role_in(db, user, x, school)]
    active = [{"case_id": str(x.id), **a} for x in rows for a in x.actions or []
              if a["kind"] in ("probation", "suspension") and (a.get("until") or "") >= today and (a.get("on") or "") <= today and not a.get("done")]
    return {"cases": cases, "active": active, "demerits_this_term": demerits_this_term(db, s), "ladder": settings(db, school.id).ladder}


@router.get("/me/discipline")
def my_work(user: User = Depends(current_user), db: Session = Depends(get_db)):
    """For the home page: discipline cases waiting for me."""
    out = []
    for sid, school in rights.school_ids_with_rights(db, user).items():
        if not is_staff(user, school):
            continue
        d = list_cases(sid, "inbox", user, db)
        if d["counts"]["inbox"]:
            out.append({"school": {"id": str(sid), "name": school.name}, "waiting": d["counts"]["inbox"], "cases": d["cases"][:5]})
    return out


# ---------- Families ----------

@router.get("/me/children/{student_id}/discipline")
def family_view(student_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    s, rel = child_for(db, user, student_id)
    st = settings(db, s.school_id)
    out = []
    for x in db.scalars(select(DisciplineCase).where(DisciplineCase.student_id == s.id).order_by(DisciplineCase.occurred_at.desc())):
        shown = visible_to_family(x, st)
        if shown:
            out.append({"id": str(x.id), "number": x.number, "offence_name": x.offence_name, "level": x.level, "occurred_at": x.occurred_at.isoformat(),
                        "decision": x.decision if st.parents_see == "all" else None, "decided_at": x.decided_at.isoformat() if x.decided_at else None,
                        "actions": [{"kind": a["kind"], "label": a["label"], "text": say(a), "done": bool(a.get("done"))} for a in shown],
                        "seen_at": x.parent_seen_at.isoformat() if x.parent_seen_at else None, "reply": x.parent_reply})
    school = db.get(School, s.school_id)
    return {"relation": rel, "cases": out, "demerits_this_term": demerits_this_term(db, s), "ladder": st.ladder,
            "school": {"name": school.name, "logo": school.logo, "address": school.address, "phone": school.phone}}


class SeenIn(BaseModel):
    reply: str | None = Field(default=None, max_length=1000)


@router.post("/me/children/{student_id}/discipline/{cid}/seen")
def family_seen(student_id: uuid.UUID, cid: uuid.UUID, data: SeenIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    s, rel = child_for(db, user, student_id)
    if rel != "parent":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "A parent or guardian confirms this")
    case = db.get(DisciplineCase, cid)
    st = settings(db, s.school_id)
    if not case or case.student_id != s.id or not visible_to_family(case, st):
        raise not_found("Case")
    case.parent_seen_at, case.parent_reply = now(), (data.reply or "").strip() or None
    log(case, name_of(db, user.id), "Parent read it" + (f": “{case.parent_reply}”" if case.parent_reply else ""))
    school = db.get(School, s.school_id)
    notify(db, pods(db, school, st), s.school_id, f"{name_of(db, user.id)} read discipline #{case.number} about {s.full_name}"
           + (f": “{case.parent_reply}”" if case.parent_reply else "."), f"#/discipline-case/{case.id}", "gavel")
    db.commit()
    return family_view(student_id, user, db)
