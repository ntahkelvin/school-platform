"""Students check their marks against their scripts.

- Every script is handed back, so a student writes in their score book what the teacher wrote on it (with a photo if they like).
- When a test is approved, the student sees the official mark beside their own. If they match, it is confirmed by itself.
- Otherwise they confirm it, or query it with a note (and a photo). The teacher keeps the mark with a reply, or corrects it;
  a correction goes back to the unit head or HOD before students see it.
- Not happy with the reply? The student asks the head to look. The head keeps the mark, or sends the sheet back to the teacher.
- Students have the school's number of school days from approval. After that, marks they did not query count as accepted.
- Parents never see any of this: they see a test only once it is published.
"""
import uuid
from collections import defaultdict
from datetime import date, datetime, time, timedelta, timezone

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
    ComponentRelease, Score, ScoreBookEntry, ScoreCheck, SheetStep, Student, Subject, Term, User,
)

router = APIRouter(prefix="/api", tags=["score book"])
WAT = timezone(timedelta(hours=1))
DONE = {"match", "confirmed", "accepted", "answered", "corrected", "closed"}
OPEN = {"queried", "escalated", "correcting"}
LABEL = {"not_yet": "Not out yet", "waiting": "Check it", "different": "Different from yours", "match": "Matches yours", "confirmed": "Confirmed",
         "accepted": "Accepted (time passed)", "queried": "Query sent", "answered": "Teacher replied", "escalated": "With the head", "correcting": "Being corrected",
         "corrected": "Corrected", "closed": "Head kept the mark"}


def now() -> datetime:
    return datetime.now(timezone.utc)


def school_days_after(start: datetime, n: int) -> datetime:
    """The end of the n-th school day (Monday to Friday) after start, in Nigerian time."""
    d = start.astimezone(WAT).date()
    left = n
    while left > 0:
        d += timedelta(days=1)
        if d.weekday() < 5:
            left -= 1
    return datetime.combine(d, time(23, 59), tzinfo=WAT)


def due_of(step: SheetStep | None, days: int) -> datetime | None:
    return school_days_after(step.approved_at, days) if step and step.approved_at else None


def comp_keys(cols: list[dict], comp: str) -> list[dict]:
    return [c for c in cols if c["key"].split(" › ")[0] == comp]


def compare(official: dict, recorded: dict) -> str:
    keys = [k for k in recorded if k in official]
    if not keys:
        return "none"
    return "match" if all(official[k] is not None and abs(official[k] - recorded[k]) < 0.01 for k in keys) else "different"


def state_of(visible: bool, due: datetime | None, cmp: str, row: ScoreCheck | None) -> str:
    if not visible:
        return "not_yet"
    if row:
        return row.status
    if cmp == "match":
        return "match"
    if due is None or due <= now():
        return "accepted"
    return "different" if cmp == "different" else "waiting"


def bulk(db: Session, term_id: uuid.UUID, student_ids: list, subject_ids: list | None = None) -> tuple[dict, dict, dict, dict]:
    """Marks, score book entries and checks for many students at once: {(student, subject): {key: value}}, ..."""
    ids = student_ids or [uuid.uuid4()]
    q = lambda M: select(M).where(M.term_id == term_id, M.student_id.in_(ids), *([M.subject_id.in_(subject_ids)] if subject_ids else []))  # noqa: E731
    marks, absent, book, checks = defaultdict(dict), defaultdict(set), defaultdict(dict), {}
    for r in db.scalars(q(Score)):
        marks[(r.student_id, r.subject_id)][r.component] = r.value
        if r.absent:
            absent[(r.student_id, r.subject_id)].add(r.component)
    for b in db.scalars(q(ScoreBookEntry)):
        book[(b.student_id, b.subject_id)][b.key] = b
    for c in db.scalars(q(ScoreCheck)):
        checks[(c.student_id, c.subject_id, c.component)] = c
    return marks, absent, book, checks


def cell(comp: str, cols: list[dict], step: SheetStep | None, days: int, marks: dict, absent: set, book: dict, row: ScoreCheck | None, locked: bool) -> dict:
    """One test in one subject for one student: their mark, what they wrote, and where the check stands."""
    from app.api.checks import step_status
    keys = comp_keys(cols, comp)
    visible = bool(step and step.approved_at)
    due = due_of(step, days)
    official = {c["key"]: (None if c["key"] in absent else marks.get(c["key"])) for c in keys} if visible else {}
    recorded = {k: b.value for k, b in book.items() if k in {c["key"] for c in keys}}
    cmp = compare(official, recorded) if visible else "none"
    st = state_of(visible, due, cmp, row)
    total = round(sum(v for v in official.values() if v is not None), 1) if visible and any(v is not None for v in official.values()) else None
    late = bool(due and due <= now())
    escalate_until = school_days_after(row.answered_at, days) if row and row.answered_at else None
    return {
        "visible": visible, "rechecking": visible and step_status(step) != "approved", "locked": locked,
        "official": official, "absent": [k for k in official if k in absent], "total": total,
        "recorded": {k: {"value": b.value, "photo": bool(b.photo), "note": b.note} for k, b in book.items() if k in recorded},
        "compare": cmp, "state": st, "label": LABEL.get(st, st), "due_at": due.isoformat() if due else None, "late": late,
        "check": {"id": str(row.id), "status": row.status, "query_text": row.query_text, "claimed": row.claimed, "has_photo": bool(row.query_photo), "reply": row.reply,
                  "answered_at": row.answered_at.isoformat() if row.answered_at else None, "history": row.history or []} if row else None,
        "can_confirm": st in ("waiting", "different") and not late,
        "can_query": st in ("waiting", "different", "match", "confirmed") and not late and not locked,
        "can_escalate": st == "answered" and bool(escalate_until and escalate_until > now()) and not locked,
        "can_accept": st == "answered",
    }


def student_view(db: Session, s: Student, term: Term, can_act: bool) -> dict:
    from app.api.assessment import Scope, columns_of, scheme_for, student_scopes
    from app.api.checks import get_step, releases, settings
    days = settings(db, s.school_id).confirm_days
    scopes = student_scopes(db, s)
    marks, absent, book, checks = bulk(db, term.id, [s.id])
    rel = releases(db, term.id)
    subjects, tests = [], {}
    for key, sub_id in scopes:
        sc = Scope(db, key)
        scheme = scheme_for(db, sc.school.id, sc.level)
        cols = columns_of(scheme)
        for c in scheme:
            tests.setdefault(c["name"], {"name": c["name"], "max": c["max"], "parts": [{"key": x["key"], "label": x["label"], "max": x["max"]} for x in comp_keys(cols, c["name"])]})
        row = {"subject_id": str(sub_id), "subject": sc.subject.name, "teacher": name_of(db, sc.teacher_id), "scope": key, "tests": {}}
        for c in scheme:
            step = get_step(db, term.id, key, c["name"])
            r = rel.get((s.class_id, c["name"]))
            row["tests"][c["name"]] = cell(c["name"], cols, step, days, marks[(s.id, sub_id)], absent[(s.id, sub_id)], book[(s.id, sub_id)],
                                           checks.get((s.id, sub_id, c["name"])), bool(r and r.locked))
        subjects.append(row)
    subjects.sort(key=lambda x: x["subject"])
    flat = [t for x in subjects for t in x["tests"].values()]
    from app.api.assessment import term_out
    return {"term": term_out(term), "confirm_days": days, "tests": list(tests.values()), "subjects": subjects, "can_act": can_act,
            "counts": {"to_check": sum(1 for t in flat if t["state"] in ("waiting", "different")), "different": sum(1 for t in flat if t["state"] == "different"),
                       "open": sum(1 for t in flat if t["state"] in OPEN), "replied": sum(1 for t in flat if t["state"] == "answered"),
                       "done": sum(1 for t in flat if t["state"] in DONE), "out": sum(1 for t in flat if t["visible"]),
                       "next_due": min((t["due_at"] for t in flat if t["state"] in ("waiting", "different") and t["due_at"]), default=None)}}


def own(db: Session, user: User, student_id: uuid.UUID, act: bool = False) -> Student:
    """Only the student themselves: parents see published tests only (on the Results tab)."""
    s, how = child_for(db, user, student_id)
    if how != "self":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the student checks their own marks. Parents see each test once the school publishes it.")
    if act and rights.acting(user):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Nothing can be changed while seeing as someone else")
    return s


def term_for(db: Session, s: Student, term_id: uuid.UUID | None) -> Term:
    from app.api.assessment import need_term
    return need_term(db, s.school_id, term_id)


@router.get("/me/children/{student_id}/my-scores")
def my_scores(student_id: uuid.UUID, term_id: uuid.UUID | None = None, user: User = Depends(current_user), db: Session = Depends(get_db)):
    s = own(db, user, student_id)
    return student_view(db, s, term_for(db, s, term_id), not rights.acting(user))


def find_subject(db: Session, s: Student, subject_id: uuid.UUID):
    from app.api.assessment import Scope, columns_of, scheme_for, student_scopes
    for key, sid in student_scopes(db, s):
        if sid == subject_id:
            sc = Scope(db, key)
            return sc, scheme_for(db, sc.school.id, sc.level), columns_of(scheme_for(db, sc.school.id, sc.level))
    raise not_found("Subject")


class BookIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    term_id: uuid.UUID
    subject_id: uuid.UUID
    key: str = Field(max_length=80)
    value: float | None = Field(default=None, ge=0, le=100)
    photo: str | None = Field(default=None, max_length=900_000)
    note: str | None = Field(default=None, max_length=300)


@router.put("/me/children/{student_id}/score-book")
def write_book(student_id: uuid.UUID, data: BookIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Write (or clear, with no value) what the teacher wrote on a returned script."""
    s = own(db, user, student_id, act=True)
    term = term_for(db, s, data.term_id)
    sc, scheme, cols = find_subject(db, s, data.subject_id)
    col = next((c for c in cols if c["key"] == data.key), None)
    if not col:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Choose a test")
    if data.photo and not data.photo.startswith("data:image/"):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "The photo must be an image")
    b = db.scalar(select(ScoreBookEntry).where(ScoreBookEntry.term_id == term.id, ScoreBookEntry.student_id == s.id, ScoreBookEntry.subject_id == data.subject_id,
                                               ScoreBookEntry.key == data.key))
    if data.value is None:
        if b:
            db.delete(b)
    else:
        if data.value > col["max"]:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"{data.key} is out of {col['max']}")
        if not b:
            b = ScoreBookEntry(term_id=term.id, student_id=s.id, subject_id=data.subject_id, key=data.key)
            db.add(b)
        b.value, b.note = data.value, data.note
        if data.photo is not None:
            b.photo = data.photo or None
    db.commit()
    return student_view(db, s, term, True)


class CheckActIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    term_id: uuid.UUID
    subject_id: uuid.UUID | None = None
    component: str | None = Field(default=None, max_length=50)
    text: str | None = Field(default=None, max_length=600)
    claimed: float | None = Field(default=None, ge=0, le=100)
    photo: str | None = Field(default=None, max_length=900_000)


def get_cell(db: Session, s: Student, term: Term, subject_id, comp: str) -> tuple[dict, object]:
    v = student_view(db, s, term, True)
    row = next((x for x in v["subjects"] if x["subject_id"] == str(subject_id)), None)
    if not row or comp not in row["tests"]:
        raise not_found("Test")
    return row["tests"][comp], row


def log(row: ScoreCheck, who: str, action: str, note: str | None = None) -> None:
    row.history = [*(row.history or []), {"at": now().isoformat(), "by": who, "action": action, "note": note}]


@router.post("/me/children/{student_id}/my-scores/confirm")
def confirm(student_id: uuid.UUID, data: CheckActIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Confirm one test, or (with no subject) every test that is out and waiting."""
    s = own(db, user, student_id, act=True)
    term = term_for(db, s, data.term_id)
    v = student_view(db, s, term, True)
    n = 0
    for x in v["subjects"]:
        if data.subject_id and x["subject_id"] != str(data.subject_id):
            continue
        for comp, t in x["tests"].items():
            if data.component and comp != data.component:
                continue
            if not data.subject_id and t["state"] != "waiting":
                continue            # "confirm all" only takes tests the student has not disagreed with
            if t["state"] == "answered" or t["can_confirm"]:
                row = db.get(ScoreCheck, uuid.UUID(t["check"]["id"])) if t["check"] else None
                if not row:
                    row = ScoreCheck(term_id=term.id, student_id=s.id, subject_id=uuid.UUID(x["subject_id"]), component=comp, scope=x["scope"], history=[])
                    db.add(row)
                row.status = "confirmed"
                log(row, s.full_name, "Confirmed")
                n += 1
    if data.subject_id and not n:
        raise HTTPException(status.HTTP_409_CONFLICT, "This mark can't be confirmed now")
    db.commit()
    return student_view(db, s, term, True) | {"confirmed": n}


@router.post("/me/children/{student_id}/my-scores/query")
def query(student_id: uuid.UUID, data: CheckActIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    from app.api.assessment import Scope, notify
    s = own(db, user, student_id, act=True)
    term = term_for(db, s, data.term_id)
    if not data.subject_id or not data.component or not (data.text and len(data.text) >= 3):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Say what you think is wrong")
    t, x = get_cell(db, s, term, data.subject_id, data.component)
    if not t["can_query"]:
        raise HTTPException(status.HTTP_409_CONFLICT, "The time to query this mark has passed" if t["late"] else "This mark can't be queried now")
    if data.photo and not data.photo.startswith("data:image/"):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "The photo must be an image")
    row = db.get(ScoreCheck, uuid.UUID(t["check"]["id"])) if t["check"] else None
    if not row:
        row = ScoreCheck(term_id=term.id, student_id=s.id, subject_id=data.subject_id, component=data.component, scope=x["scope"], history=[])
        db.add(row)
    row.status, row.query_text, row.claimed, row.reply, row.answered_at = "queried", data.text, data.claimed, None, None
    if data.photo:
        row.query_photo = data.photo
    log(row, s.full_name, "Queried", data.text)
    sc = Scope(db, x["scope"])
    notify(db, [sc.teacher_id], sc.school.id, f"{s.full_name} queried their {data.component} mark in {sc.title()}: “{data.text[:120]}”", f"#/sheet/{sc.key}", "message", "request")
    db.commit()
    return student_view(db, s, term, True)


@router.post("/me/children/{student_id}/my-scores/escalate")
def escalate(student_id: uuid.UUID, data: CheckActIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    from app.api.assessment import Scope, notify
    from app.api.checks import chain, heads
    s = own(db, user, student_id, act=True)
    term = term_for(db, s, data.term_id)
    t, x = get_cell(db, s, term, data.subject_id, data.component or "")
    if not t["can_escalate"] or not (data.text and len(data.text) >= 3):
        raise HTTPException(status.HTTP_409_CONFLICT, "Say why, while there is still time to ask")
    row = db.get(ScoreCheck, uuid.UUID(t["check"]["id"]))
    row.status = "escalated"
    log(row, s.full_name, "Asked the head to look", data.text)
    sc = Scope(db, x["scope"])
    who = chain(db, sc.school, sc.subject, sc.teacher_id) or heads(db, sc.school)
    notify(db, who, sc.school.id, f"{s.full_name} asked you to look at their {data.component} mark in {sc.title()}: “{data.text[:120]}”", "#/check", "message", "request")
    db.commit()
    return student_view(db, s, term, True)


@router.get("/me/children/{student_id}/score-book/photo")
def my_photo(student_id: uuid.UUID, term_id: uuid.UUID, subject_id: uuid.UUID, key: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    s = own(db, user, student_id)
    b = db.scalar(select(ScoreBookEntry).where(ScoreBookEntry.term_id == term_id, ScoreBookEntry.student_id == s.id, ScoreBookEntry.subject_id == subject_id, ScoreBookEntry.key == key))
    if not b or not b.photo:
        raise not_found("Photo")
    return {"photo": b.photo}


# ---------- Teachers and heads ----------

def sheet_checks(db: Session, sc, term: Term, scheme: list[dict], cols: list[dict], studs: list[Student], user: User) -> tuple[dict, list[dict]]:
    """For the score sheet: each student's check state per approved test, and the queries on this sheet."""
    from app.api.checks import authority, get_step, releases, settings
    days = settings(db, sc.school.id).confirm_days
    marks, absent, book, checks = bulk(db, term.id, [s.id for s in studs], [sc.subject.id])
    rel = releases(db, term.id)
    steps = {c["name"]: get_step(db, term.id, sc.key, c["name"]) for c in scheme}
    states: dict = defaultdict(dict)
    queries = []
    from app.api.checks import chain
    deciders = chain(db, sc.school, sc.subject, sc.teacher_id)
    head = user.id in deciders or (not deciders and authority(db, user, sc.school))
    for s in studs:
        k = (s.id, sc.subject.id)
        for c in scheme:
            st = steps[c["name"]]
            if not (st and st.approved_at):
                continue
            r = rel.get((s.class_id, c["name"]))
            row = checks.get((s.id, sc.subject.id, c["name"]))
            t = cell(c["name"], cols, st, days, marks[k], absent[k], book[k], row, bool(r and r.locked))
            states[str(s.id)][c["name"]] = t["state"]
            if row and row.status in OPEN | {"answered", "closed", "corrected"}:
                queries.append({"id": str(row.id), "student_id": str(s.id), "student": f"{s.last_name}, {s.first_name}", "component": c["name"], "status": row.status,
                                "label": LABEL[row.status], "text": row.query_text, "claimed": row.claimed, "has_photo": bool(row.query_photo or any(b.photo for kk, b in book[k].items() if kk.startswith(c["name"]))),
                                "official": t["official"], "total": t["total"], "recorded": t["recorded"], "reply": row.reply, "history": row.history or [], "locked": t["locked"],
                                "can_answer": row.status == "queried" and (sc.is_teacher(user) or authority(db, user, sc.school)) and not rights.acting(user),
                                "can_decide": row.status == "escalated" and head and not rights.acting(user)})
    order = {"queried": 0, "escalated": 1, "correcting": 2, "answered": 3, "corrected": 4, "closed": 5}
    queries.sort(key=lambda q: (order.get(q["status"], 9), q["student"]))
    return dict(states), queries


def staff_row(db: Session, user: User, cid: uuid.UUID):
    from app.api.assessment import Scope
    row = db.get(ScoreCheck, cid)
    if not row:
        raise not_found("Query")
    sc = Scope(db, row.scope)
    if not sc.can_see(user):
        raise not_found("Query")
    return row, sc


@router.get("/score-checks/{cid}/photo")
def query_photo(cid: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    row, sc = staff_row(db, user, cid)
    photos = [row.query_photo] if row.query_photo else []
    photos += [b.photo for b in db.scalars(select(ScoreBookEntry).where(ScoreBookEntry.term_id == row.term_id, ScoreBookEntry.student_id == row.student_id,
                                                                        ScoreBookEntry.subject_id == row.subject_id)) if b.photo and b.key.startswith(row.component)]
    if not photos:
        raise not_found("Photo")
    return {"photos": photos}


class AnswerIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    action: str = Field(pattern="^(keep|correct)$")
    reply: str = Field(min_length=2, max_length=600)
    marks: dict[str, float] = Field(default_factory=dict)


@router.post("/score-checks/{cid}/answer")
def answer(cid: uuid.UUID, data: AnswerIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """The teacher's answer to a query: keep the mark (with a reply), or correct it (it then goes back to be checked)."""
    from app.api.assessment import MarkIn, columns_of, notify, save_marks, scheme_for
    from app.api.checks import authority, chain, get_step, heads, log as step_log, releases
    row, sc = staff_row(db, user, cid)
    if row.status != "queried" or rights.acting(user) or not (sc.is_teacher(user) or authority(db, user, sc.school)):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This query is not waiting for you")
    s = db.get(Student, row.student_id)
    term = db.get(Term, row.term_id)
    if data.action == "keep":
        row.status, row.reply, row.answered_at = "answered", data.reply, now()
        log(row, user.full_name, "Kept the mark", data.reply)
        notify(db, [s.user_id], sc.school.id, f"{sc.subject.name} {row.component}: your teacher replied to your query. “{data.reply[:140]}”", f"#/child/{s.id}", "message")
        db.commit()
        return {"status": row.status}
    r = releases(db, term.id).get((s.class_id, row.component))
    if r and r.locked:
        raise HTTPException(status.HTTP_409_CONFLICT, "This test is published and locked. Ask the principal, VP or ICT to take the padlock off first.")
    cols = {c["key"]: c for c in columns_of(scheme_for(db, sc.school.id, sc.level)) if c["key"].split(" › ")[0] == row.component}
    if not data.marks or any(k not in cols for k in data.marks):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Type the corrected mark")
    old = {r2.component: r2.value for r2 in db.scalars(select(Score).where(Score.term_id == term.id, Score.student_id == s.id, Score.subject_id == sc.subject.id))}
    for k, v in data.marks.items():
        if v < 0 or v > cols[k]["max"]:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"{k} is out of {cols[k]['max']}")
    save_marks(db, sc, term, [MarkIn(student_id=s.id, key=k, value=v) for k, v in data.marks.items()], user)
    change = ", ".join(f"{k} {old.get(k) if old.get(k) is not None else '–'} → {v:g}" for k, v in data.marks.items())
    row.status, row.reply, row.answered_at = "correcting", data.reply, now()
    log(row, user.full_name, f"Corrected ({change}), being checked", data.reply)
    st = get_step(db, term.id, sc.key, row.component, make=True)
    if st.status == "approved":
        ch = chain(db, sc.school, sc.subject, sc.teacher_id)
        st.status, st.stage, st.waiting_for_id = "submitted", 0, (ch[0] if ch else None)
        step_log(st, user, f"Corrected after a query ({s.full_name}: {change})", data.reply)
        notify(db, [st.waiting_for_id] if st.waiting_for_id else heads(db, sc.school), sc.school.id,
               f"{row.component} for {sc.title()} was corrected after a query. Please check it again.", "#/check", "clipboard-list", "request")
    notify(db, [s.user_id], sc.school.id, f"{sc.subject.name} {row.component}: your teacher is correcting your mark. “{data.reply[:140]}”", f"#/child/{s.id}", "message")
    db.commit()
    return {"status": row.status}


class DecideIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    action: str = Field(pattern="^(keep|send_back)$")
    reply: str = Field(min_length=2, max_length=600)


@router.post("/score-checks/{cid}/decide")
def decide(cid: uuid.UUID, data: DecideIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """The unit head or HOD on a query a student asked them to look at: keep the mark, or send the sheet back to the teacher."""
    from app.api.assessment import notify
    from app.api.checks import authority, get_step, log as step_log, releases
    row, sc = staff_row(db, user, cid)
    from app.api.checks import chain
    deciders = chain(db, sc.school, sc.subject, sc.teacher_id)
    if row.status != "escalated" or rights.acting(user) or not (user.id in deciders or (not deciders and authority(db, user, sc.school))):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This query is not waiting for you")
    s = db.get(Student, row.student_id)
    if data.action == "keep":
        row.status, row.reply = "closed", data.reply
        log(row, user.full_name, "Head kept the mark", data.reply)
        notify(db, [s.user_id], sc.school.id, f"{sc.subject.name} {row.component}: the head looked at your query and kept the mark. “{data.reply[:140]}”", f"#/child/{s.id}", "message")
    else:
        r = releases(db, row.term_id).get((s.class_id, row.component))
        if r and r.locked:
            raise HTTPException(status.HTTP_409_CONFLICT, "This test is published and locked. Ask the principal, VP or ICT to take the padlock off first.")
        st = get_step(db, row.term_id, sc.key, row.component, make=True)
        st.status, st.waiting_for_id = "returned", None
        st.row_notes = {**(st.row_notes or {}), str(s.id): data.reply[:300]}
        step_log(st, user, f"Sent back after {s.full_name}'s query", data.reply)
        row.status = "correcting"
        log(row, user.full_name, "Head sent it back to the teacher", data.reply)
        notify(db, [sc.teacher_id], sc.school.id, f"{name_of(db, user.id)} sent back {row.component} for {sc.title()} after {s.full_name}'s query: “{data.reply[:140]}”", f"#/sheet/{sc.key}", "refresh", "request")
        notify(db, [s.user_id], sc.school.id, f"{sc.subject.name} {row.component}: the head asked your teacher to look at your mark again.", f"#/child/{s.id}", "message")
    db.commit()
    return {"status": row.status}


def on_approved(db: Session, sc, term: Term, comp: str, first: bool) -> None:
    """When a test is approved: students are told to check it (the first time), and corrections reach them."""
    from app.api.assessment import notify
    from app.api.checks import settings
    when = school_days_after(now(), settings(db, sc.school.id).confirm_days)
    for row in db.scalars(select(ScoreCheck).where(ScoreCheck.term_id == term.id, ScoreCheck.scope == sc.key, ScoreCheck.component == comp, ScoreCheck.status == "correcting")):
        row.status = "corrected"
        log(row, "The platform", "Correction approved")
        s = db.get(Student, row.student_id)
        notify(db, [s.user_id], sc.school.id, f"Your {sc.subject.name} {comp} mark was corrected.", f"#/child/{s.id}", "circle-check")
    if first:
        for s in sc.students():
            notify(db, [s.user_id], sc.school.id, f"Your {sc.subject.name} {comp} mark is out. Check it against your script by {when:%a %d %b}.", f"#/child/{s.id}", "clipboard-list", "request")


@router.get("/me/score-queries")
def my_queries(user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Queries waiting for this person: as the teacher, or (asked to look) as the unit head or HOD."""
    from app.api.assessment import Scope, my_scopes
    from app.api.checks import authority, chain
    mine = set(my_scopes(db, user))
    out = []
    for row in db.scalars(select(ScoreCheck).where(ScoreCheck.status.in_(["queried", "escalated"])).order_by(ScoreCheck.updated_at)):
        try:
            sc = Scope(db, row.scope)
        except HTTPException:
            continue
        as_teacher = row.status == "queried" and row.scope in mine
        deciders = chain(db, sc.school, sc.subject, sc.teacher_id)
        as_head = row.status == "escalated" and (user.id in deciders or (not deciders and authority(db, user, sc.school)))
        if not (as_teacher or as_head):
            continue
        s = db.get(Student, row.student_id)
        out.append({"id": str(row.id), "scope": row.scope, "title": sc.title(), "subject": sc.subject.name, "component": row.component, "student": s.full_name,
                    "text": row.query_text, "status": row.status, "as": "teacher" if as_teacher else "head", "at": row.updated_at.isoformat()})
    return out


# ---------- Ready to publish? ----------

def class_progress(db: Session, term: Term, c, comp: str, studs: list[Student], keys: list[str], days: int) -> dict | None:
    """Students who have checked this test in every subject, open queries, and the deadline to confirm."""
    from app.api.assessment import Scope, columns_of, scheme_for
    from app.api.checks import get_step
    steps = {k: get_step(db, term.id, k, comp) for k in keys}
    if not steps or not all(st and st.approved_at for st in steps.values()):
        return None
    school_id = Scope(db, keys[0]).school.id
    cols = columns_of(scheme_for(db, school_id, c.level))
    subj = {k: Scope(db, k).subject.id for k in keys}
    marks, absent, book, checks = bulk(db, term.id, [s.id for s in studs])
    from app.api.assessment import student_scopes
    done, open_q, waiting, dues = 0, 0, 0, []
    for s in studs:
        mine = [k for k, _ in student_scopes(db, s) if k in steps]
        ok = True
        for k in mine:
            sid = subj[k]
            t = cell(comp, cols, steps[k], days, marks[(s.id, sid)], absent[(s.id, sid)], book[(s.id, sid)], checks.get((s.id, sid, comp)), False)
            if t["state"] in OPEN:
                open_q += 1
                ok = False
            elif t["state"] in ("waiting", "different"):
                waiting += 1
                ok = False
            if t["due_at"]:
                dues.append(t["due_at"])
        done += ok
    return {"students": len(studs), "done": done, "open_queries": open_q, "to_confirm": waiting, "due_at": max(dues) if dues else None}
