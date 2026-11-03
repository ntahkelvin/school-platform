"""Checking and releasing scores, one test at a time (CA1, CA2, Exam...).

1. The teacher types marks while the test is open (until the school's deadline), then hands the test in.
2. It goes to the unit head of the subject (or the HOD when there is no unit head). With two checks set,
   it then goes to the HOD as well. Each check approves it or sends it back with notes on particular students.
3. Approved scores show to students (to confirm or query, in the next stage of the build).
4. Someone with the "Publish results" power (principal, VP, ICT by default) publishes the test for a class.
   Families then see it, and it carries a padlock: nobody can change those marks until it is opened again.
Only people with that power set deadlines, open a closed test for one teacher or everyone, and take padlocks off.
"""
import uuid
from collections import defaultdict
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.access import not_found
from app.api.deps import current_user
from app.api.family import child_for
from app.api.student360 import name_of
from app.core import rights
from app.core.db import get_db
from app.models import (
    AssessmentWindow, Branch, ComponentRelease, Department, Notice, ResultSettings, School, SchoolClass, Score, SheetStatus, SheetStep, Student, Subject, Term,
    Unit, User, WindowOpening,
)
from app.models.people import StudentStatus

router = APIRouter(prefix="/api", tags=["score checks"])
STATUS_LABEL = {"draft": "Typing", "submitted": "Being checked", "returned": "Sent back", "approved": "Approved"}


def now() -> datetime:
    return datetime.now(timezone.utc)


def comp_of(key: str) -> str:
    return key.split(" › ")[0]


def authority(db: Session, user: User, school: School) -> bool:
    """Principal, VP, ICT (by default): may set deadlines, open tests, publish and take padlocks off."""
    return rights.has(user, school, "power.publish_results", db) and not rights.acting(user)


def settings(db: Session, school_id: uuid.UUID) -> ResultSettings:
    s = db.scalar(select(ResultSettings).where(ResultSettings.school_id == school_id))
    return s or ResultSettings(school_id=school_id, checks=1, confirm_days=5)


def log(step, user: User | None, action: str, note: str | None = None) -> None:
    step.history = [*(step.history or []), {"at": now().isoformat(), "by": user.full_name if user else "The platform", "action": action, "note": note}]


# ---------- Deadlines ----------

def window(db: Session, term_id: uuid.UUID, comp: str) -> AssessmentWindow | None:
    return db.scalar(select(AssessmentWindow).where(AssessmentWindow.term_id == term_id, AssessmentWindow.component == comp))


def opening_for(db: Session, term_id: uuid.UUID, comp: str, user_id: uuid.UUID) -> WindowOpening | None:
    return db.scalar(select(WindowOpening).where(WindowOpening.term_id == term_id, WindowOpening.component == comp, WindowOpening.until > now(),
                                                 (WindowOpening.teacher_id == user_id) | (WindowOpening.teacher_id.is_(None))).order_by(WindowOpening.until.desc()))


def window_state(db: Session, term_id: uuid.UUID, comp: str, user_id: uuid.UUID | None) -> dict:
    w = window(db, term_id, comp)
    closes = w.closes_at if w else None
    shut = bool(closes and closes <= now())
    op = opening_for(db, term_id, comp, user_id) if shut and user_id else None
    return {"closes_at": closes.isoformat() if closes else None, "closed": shut, "open_for_me": (not shut) or bool(op),
            "opened_until": op.until.isoformat() if op else None}


# ---------- Padlocks ----------

def releases(db: Session, term_id: uuid.UUID, comp: str | None = None) -> dict:
    q = select(ComponentRelease).where(ComponentRelease.term_id == term_id)
    if comp:
        q = q.where(ComponentRelease.component == comp)
    return {(r.class_id, r.component): r for r in db.scalars(q)}


def locked(rel: dict, class_id, comp: str) -> bool:
    r = rel.get((class_id, comp))
    return bool(r and r.locked)


# ---------- Who checks ----------

def chain(db: Session, school: School, subject: Subject, teacher_id: uuid.UUID | None) -> list[uuid.UUID]:
    unit = db.get(Unit, subject.unit_id) if subject.unit_id else None
    dept = db.get(Department, subject.department_id) if subject.department_id else (db.get(Department, unit.department_id) if unit else None)
    uh, hod = (unit.head_user_id if unit else None), (dept.head_user_id if dept else None)
    two = settings(db, school.id).checks == 2
    # Nobody checks their own marks: a teacher who is also the unit head goes to the HOD instead.
    out = list(dict.fromkeys(x for x in [uh, hod] if x and x != teacher_id))
    return out if two else out[:1]


def get_step(db: Session, term_id: uuid.UUID, scope: str, comp: str, make: bool = False) -> SheetStep | None:
    st = db.scalar(select(SheetStep).where(SheetStep.term_id == term_id, SheetStep.scope == scope, SheetStep.component == comp))
    if not st:
        legacy = db.scalar(select(SheetStatus).where(SheetStatus.term_id == term_id, SheetStatus.scope == scope))
        if legacy and legacy.status == "submitted":                   # handed in before tests were checked one by one
            st = SheetStep(term_id=term_id, scope=scope, component=comp, status="approved", stage=0, row_notes={}, history=[])
            if make:
                db.add(st)
            return st
        if make:
            st = SheetStep(term_id=term_id, scope=scope, component=comp, status="draft", stage=0, row_notes={}, history=[])
            db.add(st)
    return st


def step_status(st: SheetStep | None) -> str:
    return st.status if st else "draft"


def may_type(db: Session, sc, term_id: uuid.UUID, comp: str, user: User, st: SheetStep | None, ws: dict) -> tuple[bool, str | None]:
    """May this person type marks for this test on this sheet (padlocks are checked per student)?"""
    s = step_status(st)
    if s == "submitted":
        return False, "Handed in and being checked"
    if s == "approved":
        return False, "Approved"
    if sc.is_teacher(user):
        if s == "returned" or ws["open_for_me"]:
            return True, None
        return False, "The deadline has passed. Ask the principal, VP or ICT to open it for you."
    if authority(db, user, sc.school):
        return True, None
    return False, "Only the subject teacher types these marks"


def sheet_steps(db: Session, sc, term, user: User, scheme: list[dict], student_classes: dict) -> dict:
    """Everything the score sheet needs to know about each test: where it is, its deadline, padlocks, and what this person may do."""
    rel = releases(db, term.id)
    classes = set(student_classes.values())
    out = {}
    for c in scheme:
        comp = c["name"]
        st = get_step(db, term.id, sc.key, comp)
        ws = window_state(db, term.id, comp, user.id)
        typ, why = may_type(db, sc, term.id, comp, user, st, ws)
        locks = [str(cid) for cid in classes if locked(rel, cid, comp)]
        pub = [str(cid) for cid in classes if (cid, comp) in rel]
        if locks and len(locks) == len(classes):
            typ, why = False, "Published and locked"
        waiting = st.waiting_for_id if st and st.status == "submitted" else None
        out[comp] = {"status": step_status(st), "label": STATUS_LABEL[step_status(st)], "waiting_for": name_of(db, waiting) if waiting else
                     ("Principal, VP or ICT" if st and st.status == "submitted" else None), "waiting_for_id": str(waiting) if waiting else None,
                     "can_type": typ, "why_not": why, "deadline": ws, "locked_classes": locks, "published_classes": pub, "locked": bool(locks) and len(locks) == len(classes),
                     "published": bool(pub) and len(pub) == len(classes),
                     "can_submit": typ and step_status(st) in ("draft", "returned") and (sc.is_teacher(user) or authority(db, user, sc.school)),
                     "can_check": bool(st and st.status == "submitted" and (st.waiting_for_id == user.id or (not st.waiting_for_id and authority(db, user, sc.school)))
                                       and not rights.acting(user)),
                     "row_notes": (st.row_notes or {}) if st and st.status == "returned" else {}, "history": (st.history or []) if st else []}
    return out


# ---------- Hand in, approve, send back ----------

def heads(db: Session, school: School) -> list[uuid.UUID]:
    """The principal and VPs, told when a test has no unit head or HOD to check it."""
    return list(rights.school_roles_users(db, school.id, {"head", "vice_principal"}))

class HandInIn(BaseModel):
    term_id: uuid.UUID
    components: list[str] = Field(min_length=1, max_length=10)
    even_if_missing: bool = False
    note: str | None = Field(default=None, max_length=300)


@router.post("/score-sheets/{scope}/hand-in")
def hand_in(scope: str, data: HandInIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    from app.api.assessment import columns_of, need_term, notify, open_scope, scheme_for, sheet
    sc = open_scope(db, user, scope)
    term = need_term(db, sc.school.id, data.term_id)
    scheme = scheme_for(db, sc.school.id, sc.level)
    names = [c["name"] for c in scheme]
    cols = columns_of(scheme)
    sh = sheet(db, sc, term, user)
    for comp in data.components:
        if comp not in names:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"There is no test called {comp}")
        info = sh["steps"][comp]
        if not info["can_submit"]:
            raise HTTPException(status.HTTP_409_CONFLICT, f"{comp}: {info['why_not'] or 'cannot be handed in now'}")
        keys = [c["key"] for c in cols if comp_of(c["key"]) == comp]
        missing = sum(1 for r in sh["students"] if any(r["marks"].get(k) is None and k not in r["absent"] for k in keys))
        if missing and not data.even_if_missing:
            raise HTTPException(status.HTTP_409_CONFLICT, f"{comp}: {missing} student{'s' if missing != 1 else ''} still {'have' if missing != 1 else 'has'} empty marks")
    for comp in data.components:
        st = get_step(db, term.id, sc.key, comp, make=True)
        ch = chain(db, sc.school, sc.subject, sc.teacher_id)
        st.status, st.stage, st.row_notes = "submitted", 0, {}
        st.waiting_for_id = ch[0] if ch else None
        log(st, user, "Handed in", data.note)
        who = [st.waiting_for_id] if st.waiting_for_id else heads(db, sc.school)
        notify(db, who, sc.school.id, f"{name_of(db, user.id)} handed in {comp} for {sc.title()}. Please check it.", f"#/check", "clipboard-list", "request")
    db.commit()
    return sheet(db, sc, term, user)


class CheckIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    term_id: uuid.UUID
    component: str = Field(max_length=50)
    action: str = Field(pattern="^(approve|return)$")
    note: str | None = Field(default=None, max_length=500)
    row_notes: dict[str, str] = Field(default_factory=dict)


@router.post("/score-sheets/{scope}/check")
def check(scope: str, data: CheckIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    from app.api.assessment import need_term, notify, open_scope, sheet
    from app.api.assessment import Scope
    sc = Scope(db, scope)
    term = need_term(db, sc.school.id, data.term_id)
    st = get_step(db, term.id, sc.key, data.component)
    if not st or st.status != "submitted" or rights.acting(user) or not (st.waiting_for_id == user.id or (not st.waiting_for_id and authority(db, user, sc.school))):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This test is not waiting for you to check")
    if data.action == "return":
        if not (data.note or data.row_notes):
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Say what needs fixing")
        st.status, st.waiting_for_id, st.row_notes = "returned", None, {k: v[:300] for k, v in data.row_notes.items() if v}
        log(st, user, "Sent back", data.note)
        n = len(st.row_notes)
        notify(db, [sc.teacher_id], sc.school.id, f"{name_of(db, user.id)} sent back {data.component} for {sc.title()}" + (f" ({n} student{'s' if n != 1 else ''} to look at)" if n else "")
               + (f": “{data.note}”" if data.note else "."), f"#/sheet/{sc.key}", "refresh", "request")
    else:
        ch = chain(db, sc.school, sc.subject, sc.teacher_id)
        log(st, user, "Approved", data.note)
        st.stage += 1
        if st.waiting_for_id and st.stage < len(ch):
            st.waiting_for_id = ch[st.stage]
            notify(db, [st.waiting_for_id], sc.school.id, f"{data.component} for {sc.title()} passed the first check. Please check it.", "#/check", "clipboard-list", "request")
        else:
            st.status, st.waiting_for_id = "approved", None
            notify(db, [sc.teacher_id], sc.school.id, f"{data.component} for {sc.title()} is approved.", f"#/sheet/{sc.key}", "circle-check")
    db.commit()
    return {"status": st.status, "label": STATUS_LABEL[st.status]}


def warnings(sh: dict, comp: str, peers: list[dict]) -> list[dict]:
    """Things a head of department should look at before approving."""
    from app.api.assessment import columns_of
    cols = [c for c in sh["columns"] if comp_of(c["key"]) == comp]
    mx = sum(c["max"] for c in cols)
    vals, missing, absent = [], 0, 0
    for r in sh["students"]:
        v = r["components"].get(comp)
        if any(c["key"] in r["absent"] for c in cols):
            absent += 1
        elif any(r["marks"].get(c["key"]) is None for c in cols):
            missing += 1
        if v is not None:
            vals.append(v)
    out = []
    if missing:
        out.append({"level": "red", "text": f"{missing} student{'s have' if missing != 1 else ' has'} no mark"})
    if absent:
        out.append({"level": "amber", "text": f"{absent} marked absent"})
    if vals and mx:
        avg = 100 * sum(vals) / len(vals) / mx
        full = sum(1 for v in vals if v >= mx)
        if avg >= 85:
            out.append({"level": "amber", "text": f"Very high average: {avg:.0f}% of the marks"})
        if avg < 35:
            out.append({"level": "amber", "text": f"Very low average: {avg:.0f}% of the marks"})
        if full >= max(3, len(vals) // 4):
            out.append({"level": "amber", "text": f"{full} students got full marks"})
        if len(set(vals)) == 1 and len(vals) > 3:
            out.append({"level": "red", "text": "Every student has the same mark"})
        for p in peers:
            if p["average"] is not None and abs(p["average"] - avg) >= 15:
                out.append({"level": "amber", "text": f"{avg:.0f}% here against {p['average']:.0f}% in {p['name']}"})
        exam = next((c["name"] for c in sh["scheme"] if "exam" in c["name"].lower()), None)
        if exam and exam != comp:
            ev = [r["components"].get(exam) for r in sh["students"] if r["components"].get(exam) is not None]
            emx = next(c["max"] for c in sh["scheme"] if c["name"] == exam)
            if ev and emx and avg - 100 * sum(ev) / len(ev) / emx >= 25:
                out.append({"level": "amber", "text": f"{comp} is much higher than the exam ({avg:.0f}% against {100 * sum(ev) / len(ev) / emx:.0f}%)"})
    if not out:
        out.append({"level": "green", "text": "Nothing unusual"})
    return out


def comp_average(sh: dict, comp: str) -> float | None:
    mx = sum(c["max"] for c in sh["columns"] if comp_of(c["key"]) == comp)
    vals = [r["components"].get(comp) for r in sh["students"] if r["components"].get(comp) is not None]
    return 100 * sum(vals) / len(vals) / mx if vals and mx else None


@router.get("/me/to-check")
def to_check(user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Tests waiting for this person to check, with what to look at in each."""
    from app.api.assessment import Scope, sheet
    rows = list(db.scalars(select(SheetStep).where(SheetStep.status == "submitted", SheetStep.waiting_for_id == user.id)))
    # Tests with nobody to check them (no unit head or HOD) go to the principal, VP and ICT.
    for st in db.scalars(select(SheetStep).where(SheetStep.status == "submitted", SheetStep.waiting_for_id.is_(None))):
        try:
            if authority(db, user, Scope(db, st.scope).school):
                rows.append(st)
        except HTTPException:
            continue
    out = []
    for st in rows:
        try:
            sc = Scope(db, st.scope)
        except HTTPException:
            continue
        term = db.get(Term, st.term_id)
        sh = sheet(db, sc, term, user, check=True)
        handed = next((h for h in reversed(st.history or []) if h["action"] == "Handed in"), None)
        out.append({"scope": st.scope, "component": st.component, "term_id": str(term.id), "term": term.name, "title": sc.title(), "subject": sc.subject.name, "group": sc.name,
                    "teacher": name_of(db, sc.teacher_id), "students": len(sh["students"]), "average": comp_average(sh, st.component),
                    "handed_in_at": handed["at"] if handed else None, "stage": st.stage + 1, "stages": max(1, len(chain(db, sc.school, sc.subject, sc.teacher_id))),
                    "warnings": [w for w in sh["checks"][st.component]["warnings"] if w["level"] != "green"]})
    out.sort(key=lambda x: x["handed_in_at"] or "")
    return out


# ---------- The principal's control room ----------

def need_school(db: Session, user: User, school_id: uuid.UUID, power: bool = False) -> School:
    school = db.get(School, school_id)
    if not school or not (rights.has(user, school, "results.see", db) or authority(db, user, school)):
        raise not_found("School")
    if power and not authority(db, user, school):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the principal, VP or ICT (anyone with the Publish results power) can do this")
    return school


@router.get("/schools/{school_id}/score-control")
def control(school_id: uuid.UUID, term_id: uuid.UUID | None = None, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Deadlines, openings, and every class's tests: how many sheets are in, checked, published and locked."""
    from app.api.academics import _level_order
    from app.api.assessment import class_subjects, need_term, scheme_for, term_out
    school = need_school(db, user, school_id)
    term = need_term(db, school.id, term_id)
    stg = settings(db, school.id)
    comps: list[str] = []
    classes = sorted(db.scalars(select(SchoolClass).join(Branch, Branch.id == SchoolClass.branch_id).where(Branch.school_id == school.id)), key=lambda c: (_level_order(c.level), c.name))
    steps = {(s.scope, s.component): s for s in db.scalars(select(SheetStep).where(SheetStep.term_id == term.id))}
    legacy = {s.scope for s in db.scalars(select(SheetStatus).where(SheetStatus.term_id == term.id, SheetStatus.status == "submitted"))}
    rel = releases(db, term.id)
    rows = []
    for c in classes:
        studs = list(db.scalars(select(Student).where(Student.class_id == c.id, Student.status == StudentStatus.active)))
        if not studs:
            continue
        scheme = [x["name"] for x in scheme_for(db, school.id, c.level)]
        for x in scheme:
            if x not in comps:
                comps.append(x)
        keys = [k for _, ks in class_subjects(db, c, studs) for k in ks]
        cell = {}
        for comp in scheme:
            n = defaultdict(int)
            for k in keys:
                s = steps.get((k, comp))
                n[s.status if s else ("approved" if k in legacy else "draft")] += 1
            r = rel.get((c.id, comp))
            cell[comp] = {"sheets": len(keys), **{k: n[k] for k in ("draft", "submitted", "returned", "approved")}, "ready": bool(keys) and n["approved"] == len(keys),
                          "published": bool(r), "locked": bool(r and r.locked), "release_id": str(r.id) if r else None,
                          "published_at": r.published_at.isoformat() if r else None}
        rows.append({"id": str(c.id), "name": c.name, "level": c.level, "students": len(studs), "tests": cell})
    wins = []
    for comp in comps:
        w = window(db, term.id, comp)
        ops = [{"id": str(o.id), "teacher": name_of(db, o.teacher_id) if o.teacher_id else "Every teacher", "teacher_id": str(o.teacher_id) if o.teacher_id else None,
                "until": o.until.isoformat(), "reason": o.reason, "by": name_of(db, o.by_id)}
               for o in db.scalars(select(WindowOpening).where(WindowOpening.term_id == term.id, WindowOpening.component == comp, WindowOpening.until > now()).order_by(WindowOpening.until))]
        wins.append({"component": comp, "closes_at": w.closes_at.isoformat() if w and w.closes_at else None, "closed": bool(w and w.closes_at and w.closes_at <= now()), "openings": ops})
    from app.api.staff_day import staff_ids
    teachers = sorted(({"id": str(u.id), "name": u.full_name} for u in db.scalars(select(User).where(User.id.in_(list(staff_ids(db, school.id)) or [uuid.uuid4()])))),
                      key=lambda x: x["name"])
    return {"term": term_out(term), "settings": {"checks": stg.checks, "confirm_days": stg.confirm_days}, "components": wins, "classes": rows,
            "can_publish": authority(db, user, school), "teachers": teachers}


class SettingsIn(BaseModel):
    checks: int = Field(ge=1, le=2)
    confirm_days: int = Field(ge=1, le=30)


@router.put("/schools/{school_id}/result-settings")
def save_settings(school_id: uuid.UUID, data: SettingsIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    need_school(db, user, school_id, power=True)
    s = db.scalar(select(ResultSettings).where(ResultSettings.school_id == school_id)) or ResultSettings(school_id=school_id)
    s.checks, s.confirm_days = data.checks, data.confirm_days
    db.add(s)
    db.commit()
    return {"checks": s.checks, "confirm_days": s.confirm_days}


class WindowIn(BaseModel):
    term_id: uuid.UUID
    component: str = Field(max_length=50)
    closes_at: datetime | None = None


@router.put("/schools/{school_id}/score-deadlines")
def set_deadline(school_id: uuid.UUID, data: WindowIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    from app.api.assessment import need_term
    school = need_school(db, user, school_id, power=True)
    term = need_term(db, school.id, data.term_id)
    w = window(db, term.id, data.component) or AssessmentWindow(school_id=school.id, term_id=term.id, component=data.component)
    w.closes_at, w.by_id = data.closes_at, user.id
    db.add(w)
    db.commit()
    return {"component": w.component, "closes_at": w.closes_at.isoformat() if w.closes_at else None}


class OpeningIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    term_id: uuid.UUID
    component: str = Field(max_length=50)
    teacher_id: uuid.UUID | None = None
    until: datetime
    reason: str | None = Field(default=None, max_length=300)


@router.post("/schools/{school_id}/score-openings", status_code=201)
def open_again(school_id: uuid.UUID, data: OpeningIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Open a closed test again, for one teacher or for everyone, until a set time."""
    from app.api.assessment import need_term, notify
    school = need_school(db, user, school_id, power=True)
    term = need_term(db, school.id, data.term_id)
    if data.until <= now():
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Choose a time in the future")
    o = WindowOpening(school_id=school.id, term_id=term.id, component=data.component, teacher_id=data.teacher_id, until=data.until, reason=data.reason, by_id=user.id)
    db.add(o)
    when = data.until.astimezone(timezone(timedelta(hours=1)))
    if data.teacher_id:
        notify(db, [data.teacher_id], school.id, f"{data.component} marks are open for you until {when:%a %d %b %H:%M}" + (f": “{data.reason}”" if data.reason else "."), "#/marks/sheets", "clock", "request")
    db.commit()
    return {"id": str(o.id)}


@router.delete("/score-openings/{oid}", status_code=204)
def close_again(oid: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    o = db.get(WindowOpening, oid)
    if not o:
        raise not_found("Opening")
    need_school(db, user, o.school_id, power=True)
    o.until = now()
    db.commit()
    return Response(status_code=204)


# ---------- Publishing one test, and the padlock ----------

def snapshot(db: Session, c: SchoolClass, term: Term, comp: str) -> tuple[dict, int]:
    from app.api.assessment import class_subjects, columns_of, scheme_for
    school_id = db.get(Branch, c.branch_id).school_id
    scheme = scheme_for(db, school_id, c.level)
    mx = next((x["max"] for x in scheme if x["name"] == comp), None)
    keys = [x["key"] for x in columns_of(scheme) if comp_of(x["key"]) == comp]
    studs = list(db.scalars(select(Student).where(Student.class_id == c.id, Student.status == StudentStatus.active)))
    subs = {sub.id: sub.name for sub, _ in class_subjects(db, c, studs)}
    out: dict = defaultdict(dict)
    for r in db.scalars(select(Score).where(Score.term_id == term.id, Score.student_id.in_([s.id for s in studs] or [uuid.uuid4()]), Score.component.in_(keys))):
        if r.subject_id not in subs:
            continue
        x = out[str(r.student_id)].setdefault(subs[r.subject_id], {"score": None, "max": mx, "absent": False})
        if r.absent:
            x["absent"] = True
        elif r.value is not None:
            x["score"] = round((x["score"] or 0) + r.value, 1)
    return dict(out), len(studs)


class ReleaseIn(BaseModel):
    term_id: uuid.UUID
    component: str = Field(max_length=50)
    class_ids: list[uuid.UUID] = Field(min_length=1, max_length=200)
    even_if_not_ready: bool = False


@router.post("/schools/{school_id}/score-releases")
def publish_test(school_id: uuid.UUID, data: ReleaseIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Publish one test (e.g. CA1) for some classes: families see it, and the marks are locked."""
    from app.api.assessment import family_of, need_term, notify
    school = need_school(db, user, school_id, power=True)
    term = need_term(db, school.id, data.term_id)
    ctl = {r["id"]: r for r in control(school.id, term.id, user, db)["classes"]}
    n, waiting = 0, []
    for cid in data.class_ids:
        row = ctl.get(str(cid))
        cell = row["tests"].get(data.component) if row else None
        if not cell:
            raise not_found("Class")
        if not cell["ready"] and not data.even_if_not_ready:
            waiting.append(f"{row['name']} ({cell['approved']}/{cell['sheets']} approved)")
    if waiting:
        raise HTTPException(status.HTTP_409_CONFLICT, "Not every sheet is approved yet: " + ", ".join(waiting[:6]))
    for cid in data.class_ids:
        c = db.get(SchoolClass, cid)
        snap, size = snapshot(db, c, term, data.component)
        r = db.scalar(select(ComponentRelease).where(ComponentRelease.term_id == term.id, ComponentRelease.class_id == c.id, ComponentRelease.component == data.component))
        again = bool(r)
        if not r:
            r = ComponentRelease(term_id=term.id, class_id=c.id, component=data.component, history=[])
            db.add(r)
        r.locked, r.published_at, r.by_id, r.snapshot = True, now(), user.id, snap
        log(r, user, "Published again" if again else "Published")
        for s in db.scalars(select(Student).where(Student.class_id == c.id, Student.status == StudentStatus.active)):
            notify(db, family_of(s), school.id, f"{s.first_name}'s {data.component} scores for {term.name} are out" + (" (corrected)" if again else "") + ".", f"#/child/{s.id}", "chart")
        n += 1
    db.commit()
    return {"published": n}


class UnlockIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    note: str = Field(min_length=3, max_length=300)
    subject_ids: list[uuid.UUID] | None = None        # only these subjects go back to their teachers (empty: every subject)


@router.post("/score-releases/{rid}/unlock")
def unlock(rid: uuid.UUID, data: UnlockIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Take the padlock off a published test so a mark can be corrected. Families keep seeing the published marks
    until it is published again. The chosen subjects (or every subject) go back to their teachers; the rest stay approved."""
    from app.api.assessment import Scope, class_subjects, notify
    r = db.get(ComponentRelease, rid)
    if not r:
        raise not_found("Published test")
    c = db.get(SchoolClass, r.class_id)
    school = need_school(db, user, db.get(Branch, c.branch_id).school_id, power=True)
    r.locked = False
    log(r, user, "Padlock taken off", data.note)
    studs = list(db.scalars(select(Student).where(Student.class_id == c.id, Student.status == StudentStatus.active)))
    want = set(data.subject_ids or [])
    for sub, keys in class_subjects(db, c, studs):
        if want and sub.id not in want:
            continue
        for k in keys:
            st = get_step(db, r.term_id, k, r.component, make=True)
            st.status, st.waiting_for_id, st.row_notes = "returned", None, {}
            log(st, user, f"Opened for corrections ({c.name})", data.note)
            notify(db, [Scope(db, k).teacher_id], school.id, f"{r.component} for {Scope(db, k).title()} is open for corrections: “{data.note}”", f"#/sheet/{k}", "lock", "request")
    db.commit()
    return {"locked": False}


@router.post("/score-releases/{rid}/lock")
def lock_again(rid: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Put the padlock back without publishing again (nothing was changed)."""
    r = db.get(ComponentRelease, rid)
    if not r:
        raise not_found("Published test")
    c = db.get(SchoolClass, r.class_id)
    need_school(db, user, db.get(Branch, c.branch_id).school_id, power=True)
    r.locked = True
    log(r, user, "Padlock put back")
    db.commit()
    return {"locked": True}


# ---------- What families see ----------

@router.get("/me/children/{student_id}/scores")
def family_scores(student_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Published tests only, as they were when published."""
    s, _ = child_for(db, user, student_id)
    terms: dict = {}
    for r, t in db.execute(select(ComponentRelease, Term).join(Term, Term.id == ComponentRelease.term_id).where(ComponentRelease.class_id == s.class_id)
                           .order_by(ComponentRelease.published_at)):
        mine = (r.snapshot or {}).get(str(s.id))
        if mine is None:
            continue
        x = terms.setdefault(str(t.id), {"term": t.name, "session": t.session.name, "number": t.number, "tests": [], "subjects": defaultdict(dict)})
        x["tests"].append({"name": r.component, "published_at": r.published_at.isoformat(), "max": next(iter(mine.values()), {}).get("max") if mine else None})
        for sub, v in mine.items():
            x["subjects"][sub][r.component] = v
    from app.api.assessment import scheme_for
    c = db.get(SchoolClass, s.class_id) if s.class_id else None
    order = [x["name"] for x in scheme_for(db, s.school_id, c.level if c else None)]
    out = []
    for tid, x in terms.items():
        x["tests"].sort(key=lambda t: order.index(t["name"]) if t["name"] in order else 99)
        out.append({"term_id": tid, "term": x["term"], "session": x["session"], "number": x["number"], "tests": x["tests"],
                    "subjects": [{"subject": k, "scores": v} for k, v in sorted(x["subjects"].items())]})
    out.sort(key=lambda x: (x["session"], x["number"]), reverse=True)
    return {"terms": out}
