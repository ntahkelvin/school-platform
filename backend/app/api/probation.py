"""Probation: students whose results show they are failing, and the plan everyone follows to help them.

How it starts
- Every time a test is approved or published, and when report cards are published, the school's approved marks are scanned.
  A student goes on probation when (school settings): their term average is below the probation line, or they fail
  several subjects, or their average dropped a lot since last term.
- Everyone who can help is told at once: the principal and VPs, the form teacher, the subject teachers and heads of the
  weak subjects, the house master and the boarding house parent. That list is the case's team.
- The student and parents are told only once the marks behind it are published (families only ever see published results).

What happens next
- The team writes a support plan, adds actions (who does what by when) and records meetings, and sets a review date.
- Parents read the plan and acknowledge it (with a note). A letter can be printed.
- The case is closed as improved (or just closed) by the principal, VP or form teacher.
"""
import uuid
from collections import defaultdict
from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.access import not_found
from app.api.deps import current_user
from app.api.family import child_for
from app.api.student360 import name_of
from app.core import rights
from app.core.db import get_db
from app.models import (
    Bed, Branch, ComponentRelease, Hostel, House, ProbationCase, ReportCard, School, SchoolClass, Student, Subject, Term, User,
)

router = APIRouter(prefix="/api", tags=["probation"])

STATUSES = {"open": "Just started", "plan": "Plan in place", "review": "Being reviewed", "improved": "Improved", "closed": "Closed"}
ACTIVE = ("open", "plan", "review")


def now() -> datetime:
    return datetime.now(timezone.utc)


def rules(db: Session, school_id: uuid.UUID) -> dict:
    from app.api.checks import settings, settings_out
    return settings_out(settings(db, school_id))["probation"]


def pass_mark(bands: list[tuple]) -> float:
    """The lowest score that is not a fail."""
    fails = [hi for g, lo, hi, rm in bands if "fail" in (rm or "").lower() or "fail" in g.lower() or g.upper().startswith("F")]
    return (max(fails) + 1) if fails else 40


def last_average(db: Session, s: Student, term: Term) -> tuple[float | None, str | None]:
    """The average on the student's most recent published report card before this term."""
    rc = db.scalar(select(ReportCard).join(Term, Term.id == ReportCard.term_id).where(
        ReportCard.student_id == s.id, ReportCard.status == "published", ReportCard.term_id != term.id).order_by(ReportCard.published_at.desc()).limit(1))
    if rc and rc.snapshot:
        return rc.snapshot.get("summary", {}).get("average"), rc.snapshot.get("term", {}).get("name")
    return None, None


def team_for(db: Session, school: School, s: Student, weak_scopes: list[str], table) -> list[dict]:
    """Everyone who should know and help: principal and VPs, form teacher, subject teachers and heads, house master, house parent."""
    from app.api.assessment import Scope
    out: dict = {}

    def add(uid, role):
        if uid and uid not in out:
            out[uid] = role
    for uid in rights.school_roles_users(db, school.id, {"head", "head_of_school"}):
        add(uid, "Principal")
    for uid in rights.school_roles_users(db, school.id, {"vice_principal"}):
        add(uid, "Vice principal")
    c = db.get(SchoolClass, s.class_id) if s.class_id else None
    if c:
        add(c.form_teacher_id, "Form teacher")
    for key in weak_scopes:
        try:
            sc = Scope(db, key)
        except HTTPException:
            continue
        add(table.teacher.get(key) or sc.teacher_id, f"{sc.subject.name} teacher")
        for h in sc.heads():
            add(h, f"Head of {sc.subject.name}")
    if s.house_id:
        h = db.get(House, s.house_id)
        add(h.master_user_id if h else None, "House master")
    bed = db.scalar(select(Bed).where(Bed.student_id == s.id))
    if bed:
        hs = db.get(Hostel, bed.hostel_id)
        add(hs.house_parent_user_id if hs else None, "House parent (boarding)")
    return [{"id": str(uid), "name": name_of(db, uid), "role": role} for uid, role in out.items()]


def family_ids(s: Student) -> set:
    return ({s.user_id} if s.user_id else set()) | {g.user_id for g in s.guardians}


def log(case: ProbationCase, who: str, what: str) -> None:
    case.history = [*(case.history or []), {"at": now().isoformat(), "by": who, "action": what}]


def scan(db: Session, school: School, term: Term, class_ids=None, why: str = "") -> dict:
    """Look at every approved mark this term and open (or update) probation cases. Safe to run any number of times."""
    from app.api.analytics import Table
    from app.api.assessment import bands_for, notify
    r = rules(db, school.id)
    t = Table(db, school, term)
    per = defaultdict(list)
    for (sid, sub), pct in t.pct.items():
        per[sid].append((sub, pct))
    used = defaultdict(set)
    for (sid, _, comp) in t.comp:
        used[sid].add(comp)
    published = defaultdict(set)
    for rel in db.scalars(select(ComponentRelease).where(ComponentRelease.term_id == term.id, ComponentRelease.published_at.is_not(None))):
        published[rel.class_id].add(rel.component)
    cards = {rc.student_id for rc in db.scalars(select(ReportCard).where(ReportCard.term_id == term.id, ReportCard.status == "published"))}
    existing = {x.student_id: x for x in db.scalars(select(ProbationCase).where(ProbationCase.term_id == term.id, ProbationCase.school_id == school.id))}
    made = updated = told = 0
    for sid, subs in per.items():
        s = t.students[sid]
        if class_ids is not None and s.class_id not in class_ids:
            continue
        if len(subs) < 3:                         # too little to judge yet
            continue
        c = t.classes.get(s.class_id)
        pm = pass_mark(bands_for(db, school.id, c.level if c else None))
        average = round(sum(p for _, p in subs) / len(subs), 1)
        failing = sorted(((sub, p) for sub, p in subs if p < pm), key=lambda x: x[1])
        reasons = []
        if average < r["line"]:
            reasons.append(f"Average {average:g}% is below the probation line of {r['line']:g}%")
        if r["fails"] and len(failing) >= r["fails"]:
            reasons.append(f"Failing {len(failing)} subjects (below {pm:g}%)")
        before, before_term = last_average(db, s, term)
        if r["drop"] and before is not None and before - average >= r["drop"]:
            reasons.append(f"Dropped {before - average:.1f} points since {before_term} ({before:g}% to {average:g}%)")
        case = existing.get(sid)
        if not reasons:
            if case and case.status in ACTIVE and case.average is not None and average >= r["line"] and not any("Now above" in (h.get("action") or "") for h in (case.history or [])[-1:]):
                case.average = average
                log(case, "System", f"Now above the line: average {average:g}%")
            continue
        weak = [{"subject_id": str(sub), "subject": t.subjects[sub].name, "pct": p} for sub, p in (failing or sorted(subs, key=lambda x: x[1])[:3])]
        weak_scopes = [t.scope_of[(sid, sub)] for sub, _ in (failing or sorted(subs, key=lambda x: x[1])[:3]) if (sid, sub) in t.scope_of]
        team = team_for(db, school, s, weak_scopes, t)
        visible = sid in cards or (bool(used[sid]) and used[sid] <= published[s.class_id])
        link = "#/probation/{}"
        if not case:
            case = ProbationCase(id=uuid.uuid4(), school_id=school.id, term_id=term.id, student_id=sid, status="open", reasons=reasons, weak=weak, team=team,
                                 average=average, family_told=False, actions=[], meetings=[], history=[])
            db.add(case)
            existing[sid] = case
            log(case, "System", "Put on probation" + (f" ({why})" if why else "") + ": " + "; ".join(reasons))
            notify(db, [uuid.UUID(m["id"]) for m in team], school.id,
                   f"Probation: {s.full_name} ({c.name if c else ''}) needs help. " + "; ".join(reasons) + ". Weakest: " + ", ".join(f"{w['subject']} {w['pct']:g}%" for w in weak[:3]) + ".",
                   link.format(case.id), "alert-triangle", "request")
            made += 1
        else:
            new = [x for x in reasons if x.split(" ")[0] not in {y.split(" ")[0] for y in case.reasons or []}]
            if case.status in ("improved", "closed"):
                case.status = "open"
                log(case, "System", "Opened again: " + "; ".join(reasons))
                new = reasons
            known = {m["id"] for m in case.team or []}
            fresh = [m for m in team if m["id"] not in known]
            case.reasons, case.weak, case.average = reasons, weak, average
            case.team = [*(case.team or []), *fresh]
            if new or fresh:
                notify(db, [uuid.UUID(m["id"]) for m in (case.team if new else fresh)], school.id,
                       f"Probation update: {s.full_name}. " + "; ".join(reasons) + ".", link.format(case.id), "alert-triangle", "request")
                updated += 1
        if visible and not case.family_told:
            case.family_told = True
            log(case, "System", "Student and parents told")
            notify(db, family_ids(s), school.id,
                   f"{s.first_name} has been placed on academic probation for {term.name}: " + "; ".join(reasons).lower() + ". The school has a plan to help — please read it and acknowledge.",
                   f"#/child/{s.id}", "alert-triangle", "request")
            told += 1
    db.flush()
    return {"opened": made, "updated": updated, "families_told": told}


def safe_scan(db: Session, school: School, term: Term, class_ids=None, why: str = "") -> None:
    """Scan without ever breaking the thing that triggered it (an approval, a publish)."""
    try:
        with db.begin_nested():
            scan(db, school, term, class_ids, why)
    except Exception:  # noqa: BLE001 - probation must never stop marks being approved or published
        import logging
        logging.getLogger(__name__).exception("probation scan failed")


# ---------- Who may see a case ----------

def may_manage(db: Session, user: User, school: School) -> bool:
    from app.api.checks import authority
    return authority(db, user, school) or (rights.has(user, school, "results.change", db) and not rights.acting(user))


def may_see_all(db: Session, user: User, school: School) -> bool:
    return may_manage(db, user, school) or rights.has(user, school, "results.see", db)


def on_team(case: ProbationCase, user: User) -> bool:
    return str(user.id) in {m["id"] for m in case.team or []}


def get_case(db: Session, user: User, cid: uuid.UUID) -> tuple[ProbationCase, School, bool]:
    case = db.get(ProbationCase, cid)
    school = db.get(School, case.school_id) if case else None
    if not case or not (may_see_all(db, user, school) or on_team(case, user)):
        raise not_found("Probation case")
    s = db.get(Student, case.student_id)
    c = db.get(SchoolClass, s.class_id) if s.class_id else None
    lead = may_manage(db, user, school) or bool(c and c.form_teacher_id == user.id)
    return case, school, lead


def case_out(db: Session, case: ProbationCase, full: bool = True) -> dict:
    s = db.get(Student, case.student_id)
    c = db.get(SchoolClass, s.class_id) if s.class_id else None
    term = db.get(Term, case.term_id)
    out = {"id": str(case.id), "student": {"id": str(s.id), "name": s.full_name, "first_name": s.first_name, "admission_no": s.admission_no, "thumb": s.photo_thumb,
                                           "class_name": c.name if c else None},
           "term": {"id": str(term.id), "name": term.name, "session": term.session.name}, "status": case.status, "status_label": STATUSES.get(case.status, case.status),
           "average": case.average, "reasons": case.reasons or [], "weak": case.weak or [], "family_told": case.family_told,
           "review_on": case.review_on.isoformat() if case.review_on else None, "opened_at": case.created_at.isoformat() if case.created_at else None,
           "acknowledged": case.parent_ack_at.isoformat() if case.parent_ack_at else None, "plan": bool(case.plan),
           "actions_done": sum(1 for a in case.actions or [] if a.get("done")), "actions": len(case.actions or [])}
    if full:
        out.update({"plan": case.plan, "actions": case.actions or [], "meetings": case.meetings or [], "team": case.team or [], "history": case.history or [],
                    "parent_note": case.parent_note, "acknowledged_by": name_of(db, case.parent_ack_by) if case.parent_ack_by else None,
                    "actions_done": sum(1 for a in case.actions or [] if a.get("done")), "actions_total": len(case.actions or [])})
    return out


# ---------- Staff ----------

@router.get("/schools/{school_id}/probation")
def list_cases(school_id: uuid.UUID, term_id: uuid.UUID | None = None, user: User = Depends(current_user), db: Session = Depends(get_db)):
    from app.api.assessment import need_term, term_out
    school = db.get(School, school_id)
    if not school:
        raise not_found("School")
    term = need_term(db, school.id, term_id)
    q = select(ProbationCase).where(ProbationCase.school_id == school.id, ProbationCase.term_id == term.id)
    cases = list(db.scalars(q))
    everyone = may_see_all(db, user, school)
    if not everyone:
        cases = [x for x in cases if on_team(x, user)]
    rows = sorted((case_out(db, x, full=False) for x in cases), key=lambda r: (r["status"] not in ACTIVE, r["average"] or 0))
    counts = defaultdict(int)
    for r in rows:
        counts[r["status"]] += 1
    return {"term": term_out(term), "cases": rows, "counts": counts, "rules": rules(db, school.id), "can_scan": may_manage(db, user, school), "all": everyone,
            "statuses": STATUSES}


@router.post("/schools/{school_id}/probation/scan")
def scan_now(school_id: uuid.UUID, term_id: uuid.UUID | None = None, user: User = Depends(current_user), db: Session = Depends(get_db)):
    from app.api.assessment import need_term
    school = db.get(School, school_id)
    if not school or not may_manage(db, user, school):
        raise not_found("School")
    out = scan(db, school, need_term(db, school.id, term_id), why=f"checked by {name_of(db, user.id)}")
    db.commit()
    return out


@router.get("/probation/{cid}")
def one_case(cid: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    case, school, lead = get_case(db, user, cid)
    return {**case_out(db, case), "can_lead": lead, "can_help": True, "statuses": STATUSES, "school": {"id": str(school.id), "name": school.name, "logo": school.logo,
            "address": school.address, "phone": school.phone, "motto": school.motto}}


class CaseIn(BaseModel):
    plan: str | None = Field(default=None, max_length=4000)
    status: str | None = Field(default=None, pattern="^(open|plan|review|improved|closed)$")
    review_on: date | None = None


@router.put("/probation/{cid}")
def save_case(cid: uuid.UUID, data: CaseIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    from app.api.assessment import notify
    case, school, lead = get_case(db, user, cid)
    who = name_of(db, user.id)
    s = db.get(Student, case.student_id)
    if data.plan is not None and data.plan.strip() != (case.plan or ""):
        first = not case.plan
        case.plan = data.plan.strip() or None
        log(case, who, "Wrote the support plan" if first else "Changed the support plan")
        if case.status == "open" and case.plan:
            case.status = "plan"
        if case.family_told and case.plan:
            case.parent_ack_at, case.parent_ack_by = None, None
            notify(db, family_ids(s), school.id, f"The school's plan to help {s.first_name} is ready. Please read it and acknowledge.", f"#/child/{s.id}", "alert-triangle", "request")
    if data.review_on is not None:
        case.review_on = data.review_on
        log(case, who, f"Review set for {data.review_on:%a %d %b}")
    if data.status and data.status != case.status:
        if not lead:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the principal, VP or form teacher can change the status")
        case.status = data.status
        log(case, who, f"Status: {STATUSES[data.status]}")
        if data.status in ("improved", "closed"):
            notify(db, [uuid.UUID(m["id"]) for m in case.team or []], school.id, f"Probation for {s.full_name}: {STATUSES[data.status].lower()}.", f"#/probation/{case.id}", "circle-check")
            if case.family_told:
                notify(db, family_ids(s), school.id, f"{s.first_name}'s probation is {'over: well done' if data.status == 'improved' else 'closed'}.", f"#/child/{s.id}", "circle-check")
    db.commit()
    return one_case(cid, user, db)


class ActionIn(BaseModel):
    what: str = Field(min_length=3, max_length=300)
    who: str | None = Field(default=None, max_length=100)
    due: date | None = None


@router.post("/probation/{cid}/actions")
def add_action(cid: uuid.UUID, data: ActionIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    case, school, _ = get_case(db, user, cid)
    case.actions = [*(case.actions or []), {"id": uuid.uuid4().hex[:8], "what": data.what.strip(), "who": (data.who or "").strip() or None,
                                            "due": data.due.isoformat() if data.due else None, "done": None, "by": name_of(db, user.id)}]
    log(case, name_of(db, user.id), f"Added an action: {data.what.strip()}")
    if case.status == "open":
        case.status = "plan"
    db.commit()
    return one_case(cid, user, db)


@router.post("/probation/{cid}/actions/{aid}/done")
def action_done(cid: uuid.UUID, aid: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    case, _, _ = get_case(db, user, cid)
    acts = [dict(a) for a in case.actions or []]
    for a in acts:
        if a["id"] == aid:
            a["done"] = None if a.get("done") else now().isoformat()
            log(case, name_of(db, user.id), ("Done: " if a["done"] else "Not done after all: ") + a["what"])
    case.actions = acts
    db.commit()
    return one_case(cid, user, db)


class MeetingIn(BaseModel):
    on: date
    with_who: str = Field(min_length=2, max_length=200)
    notes: str = Field(min_length=3, max_length=3000)


@router.post("/probation/{cid}/meetings")
def add_meeting(cid: uuid.UUID, data: MeetingIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    case, _, _ = get_case(db, user, cid)
    case.meetings = [*(case.meetings or []), {"id": uuid.uuid4().hex[:8], "on": data.on.isoformat(), "with": data.with_who.strip(), "notes": data.notes.strip(),
                                              "by": name_of(db, user.id)}]
    log(case, name_of(db, user.id), f"Recorded a meeting with {data.with_who.strip()}")
    if case.status in ("open", "plan"):
        case.status = "review" if case.plan else case.status
    db.commit()
    return one_case(cid, user, db)


@router.get("/students/{student_id}/probation")
def student_cases(student_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """For the student's profile banner: active cases this person may open."""
    s = db.get(Student, student_id)
    if not s:
        raise not_found("Student")
    school = db.get(School, s.school_id)
    cases = list(db.scalars(select(ProbationCase).where(ProbationCase.student_id == s.id).order_by(ProbationCase.created_at.desc())))
    everyone = may_see_all(db, user, school)
    return [case_out(db, x, full=False) for x in cases if everyone or on_team(x, user)]


# ---------- Family ----------

def family_case_out(db: Session, case: ProbationCase) -> dict:
    o = case_out(db, case)
    return {k: o[k] for k in ("id", "student", "term", "status", "status_label", "average", "reasons", "weak", "review_on", "opened_at", "plan", "acknowledged",
                              "acknowledged_by", "parent_note", "actions_done", "actions_total")} | {
        "actions": [{"what": a["what"], "who": a.get("who"), "due": a.get("due"), "done": bool(a.get("done"))} for a in case.actions or []],
        "meetings": [{"on": m["on"], "with": m["with"]} for m in case.meetings or []],     # notes stay with staff
        "contacts": [m for m in case.team or [] if m["role"] in ("Form teacher", "Principal", "Vice principal")]}


@router.get("/me/children/{student_id}/probation")
def family_cases(student_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    s, rel = child_for(db, user, student_id)
    cases = db.scalars(select(ProbationCase).where(ProbationCase.student_id == s.id, ProbationCase.family_told.is_(True)).order_by(ProbationCase.created_at.desc()))
    return {"relation": rel, "cases": [family_case_out(db, x) for x in cases]}


class AckIn(BaseModel):
    note: str | None = Field(default=None, max_length=1000)


@router.post("/me/children/{student_id}/probation/{cid}/acknowledge")
def acknowledge(student_id: uuid.UUID, cid: uuid.UUID, data: AckIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    from app.api.assessment import notify
    s, rel = child_for(db, user, student_id)
    if rel != "parent":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "A parent or guardian acknowledges the plan")
    case = db.get(ProbationCase, cid)
    if not case or case.student_id != s.id or not case.family_told:
        raise not_found("Probation case")
    case.parent_ack_at, case.parent_ack_by, case.parent_note = now(), user.id, (data.note or "").strip() or None
    log(case, name_of(db, user.id), "Parent acknowledged the plan" + (f": “{case.parent_note}”" if case.parent_note else ""))
    notify(db, [uuid.UUID(m["id"]) for m in case.team or [] if m["role"] in ("Form teacher", "Principal", "Vice principal")], case.school_id,
           f"{name_of(db, user.id)} acknowledged the probation plan for {s.full_name}" + (f": “{case.parent_note}”" if case.parent_note else "."), f"#/probation/{case.id}", "circle-check")
    db.commit()
    return family_cases(student_id, user, db)


@router.get("/me/probation")
def my_cases(user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Active probation cases this person helps with (or, for the principal and VPs, all of them): for the home page."""
    out, schools = [], {}
    for case in db.scalars(select(ProbationCase).where(ProbationCase.status.in_(ACTIVE)).order_by(ProbationCase.average)):
        if case.school_id not in schools:
            sch = db.get(School, case.school_id)
            schools[case.school_id] = (sch, may_see_all(db, user, sch))
        sch, everyone = schools[case.school_id]
        if everyone or on_team(case, user):
            out.append((sch, case))
    return {"total": len(out), "schools": [{"id": str(sid), "name": sch.name} for sid, (sch, _) in schools.items() if any(x[0].id == sid for x in out)],
            "no_plan": sum(1 for _, c in out if not c.plan), "cases": [case_out(db, c, full=False) for _, c in out[:6]]}
