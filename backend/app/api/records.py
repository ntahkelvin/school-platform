"""A student's academic record: this year (class, subjects, teachers, how each term is going), every year before,
previous schools, and choosing elective subjects. Scores and report cards will be added to the same record."""
import re
import uuid
from collections import Counter
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.access import check, not_found
from app.api.deps import current_user
from app.api.family import child_for
from app.api.staff_day import now_wat
from app.api.student360 import get_student, placement
from app.core import rights
from app.core.db import get_db
from app.models import (
    AcademicSession, AttendanceRecord, Branch, ClassSubject, ConductEntry, Enrolment, Loan, Notice, ReadingEntry, School, SchoolClass, Student,
    StudentAward, StudentElective, Subject, SubjectChoice, SubjectChoiceWindow, Term, TeachingGroup, TimetableGroupSlot, TimetableSlot, User,
)
from app.models.attendance import AttendanceKind, AttendanceStatus
from app.models.people import StudentStatus

router = APIRouter(prefix="/api", tags=["records"])
OUTCOMES = {"current": "This year", "promoted": "Moved up", "repeated": "Repeated the class", "graduated": "Graduated", "left": "Left the school", "previous": "Before joining"}


# ---------- Sessions and terms ----------

def academic_year(d: date) -> str:
    return f"{d.year}/{d.year + 1}" if d.month >= 9 else f"{d.year - 1}/{d.year}"


def current_term(db: Session, school_id: uuid.UUID) -> Term | None:
    t = db.scalar(select(Term).join(AcademicSession, AcademicSession.id == Term.session_id).where(AcademicSession.school_id == school_id, Term.is_current.is_(True)))
    if t:
        return t
    today = now_wat().date()
    return db.scalar(select(Term).join(AcademicSession, AcademicSession.id == Term.session_id).where(
        AcademicSession.school_id == school_id, Term.starts_on <= today, Term.ends_on >= today))


def session_label(db: Session, school_id: uuid.UUID) -> str:
    t = current_term(db, school_id)
    return t.session.name if t else academic_year(now_wat().date())


def next_label(label: str) -> str:
    m = re.match(r"(\d{4})\D+(\d{4})", label or "")
    return f"{int(m.group(1)) + 1}/{int(m.group(2)) + 1}" if m else academic_year(now_wat().date() + timedelta(days=200))


# ---------- Keeping the history ----------

def subjects_snapshot(db: Session, s: Student) -> list[dict]:
    return [{"name": x["name"], "teacher": x["teacher"]} for x in placement(db, s)["subjects"]]


def ensure_current(db: Session, s: Student) -> Enrolment | None:
    """Every student on the roll has one open year at this school."""
    if s.status != StudentStatus.active:
        return None
    e = db.scalar(select(Enrolment).where(Enrolment.student_id == s.id, Enrolment.outcome == "current"))
    if e:
        if e.class_id != s.class_id and s.class_id:
            # Moved class during the year (e.g. from JSS 1A to JSS 1B): keep the year, show the new class.
            c = db.get(SchoolClass, s.class_id)
            e.class_id, e.class_name, e.level = c.id, c.name, c.level
        return e
    c = db.get(SchoolClass, s.class_id) if s.class_id else None
    ft = db.get(User, c.form_teacher_id) if c and c.form_teacher_id else None
    e = Enrolment(school_id=s.school_id, student_id=s.id, session_label=session_label(db, s.school_id), class_id=c.id if c else None,
                  class_name=c.name if c else None, level=c.level if c else None, form_teacher=ft.full_name if ft else None,
                  started_on=s.admitted_on if s.admitted_on and s.admitted_on > now_wat().date() - timedelta(days=330) else None, outcome="current", subjects=[])
    db.add(e)
    db.flush()
    return e


def close_year(db: Session, s: Student, outcome: str, run_id: uuid.UUID | None = None) -> None:
    e = ensure_current(db, s) if s.status == StudentStatus.active else db.scalar(select(Enrolment).where(Enrolment.student_id == s.id, Enrolment.outcome == "current"))
    if not e:
        return
    c = db.get(SchoolClass, e.class_id) if e.class_id else None
    ft = db.get(User, c.form_teacher_id) if c and c.form_teacher_id else None
    e.subjects = subjects_snapshot(db, s)
    e.form_teacher = ft.full_name if ft else e.form_teacher
    e.outcome, e.ended_on, e.run_id = outcome, now_wat().date(), run_id


def open_year(db: Session, s: Student, label: str, run_id: uuid.UUID | None = None) -> None:
    c = db.get(SchoolClass, s.class_id) if s.class_id else None
    db.add(Enrolment(school_id=s.school_id, student_id=s.id, session_label=label, class_id=c.id if c else None, class_name=c.name if c else None,
                     level=c.level if c else None, started_on=now_wat().date(), outcome="current", subjects=[], run_id=run_id))


def undo_years(db: Session, run_id: uuid.UUID) -> None:
    for e in db.scalars(select(Enrolment).where(Enrolment.run_id == run_id)):
        if e.outcome == "current":
            db.delete(e)
    db.flush()
    for e in db.scalars(select(Enrolment).where(Enrolment.run_id == run_id)):
        e.outcome, e.ended_on, e.run_id, e.subjects = "current", None, None, []


def apply_choices(db: Session, s: Student) -> int:
    """Approved subject choices for the level the student has just moved into become their electives."""
    c = db.get(SchoolClass, s.class_id) if s.class_id else None
    if not c:
        return 0
    n = 0
    for ch, w in db.execute(select(SubjectChoice, SubjectChoiceWindow).join(SubjectChoiceWindow, SubjectChoiceWindow.id == SubjectChoice.window_id)
                            .where(SubjectChoice.student_id == s.id, SubjectChoice.status == "approved", SubjectChoice.applied.is_(False), SubjectChoiceWindow.for_level == c.level)):
        for sid in ch.approved_ids or []:
            sub = uuid.UUID(sid)
            if not db.scalar(select(StudentElective.id).where(StudentElective.student_id == s.id, StudentElective.subject_id == sub)):
                db.add(StudentElective(student_id=s.id, subject_id=sub))
                n += 1
        ch.applied = True
    return n


# ---------- The record ----------

def term_summary(db: Session, s: Student, start: date, end: date) -> dict:
    rows = list(db.execute(select(AttendanceRecord.status, func.count()).where(AttendanceRecord.student_id == s.id, AttendanceRecord.kind == AttendanceKind.school,
                                                                              AttendanceRecord.on_date >= start, AttendanceRecord.on_date <= end).group_by(AttendanceRecord.status)).all())
    total = sum(n for _, n in rows)
    present = sum(n for st, n in rows if st in (AttendanceStatus.present, AttendanceStatus.late))
    a, b = datetime.combine(start, datetime.min.time(), tzinfo=timezone.utc), datetime.combine(end + timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc)
    merits = db.scalar(select(func.sum(ConductEntry.points)).where(ConductEntry.student_id == s.id, ConductEntry.created_at >= a, ConductEntry.created_at < b)) or 0
    books = (db.scalar(select(func.count()).select_from(ReadingEntry).where(ReadingEntry.student_id == s.id, ReadingEntry.finished_on >= start, ReadingEntry.finished_on <= end)) or 0)
    loans = db.scalar(select(func.count()).select_from(Loan).where(Loan.student_id == s.id, Loan.issued_at >= a, Loan.issued_at < b)) or 0
    awards = [w.title for w in db.scalars(select(StudentAward).where(StudentAward.student_id == s.id, StudentAward.on_date >= start, StudentAward.on_date <= end))]
    return {"days": total, "attendance": round(100 * present / total) if total else None, "absent": sum(n for st, n in rows if st == AttendanceStatus.absent),
            "points": int(merits), "books": max(books, 0), "borrowed": loans, "awards": awards}


def lessons_per_week(db: Session, s: Student) -> Counter:
    out: Counter = Counter()
    if s.class_id:
        for sid in db.scalars(select(TimetableSlot.subject_id).where(TimetableSlot.class_id == s.class_id, TimetableSlot.kind == "lesson")):
            out[sid] += 1
    gids = [g for g in db.scalars(select(StudentElective.group_id).where(StudentElective.student_id == s.id, StudentElective.group_id.is_not(None)))]
    if gids:
        for gid in db.scalars(select(TimetableGroupSlot.group_id).where(TimetableGroupSlot.group_id.in_(gids))):
            g = db.get(TeachingGroup, gid)
            if g:
                out[g.subject_id] += 1
    return out


def record(db: Session, s: Student, full: bool) -> dict:
    school = db.get(School, s.school_id)
    today = now_wat().date()
    ensure_current(db, s)
    place = placement(db, s)
    subs = {x.name: x.id for x in db.scalars(select(Subject).where(Subject.school_id == s.school_id))}
    per_week = lessons_per_week(db, s)
    subjects = [{**x, "per_week": per_week.get(subs.get(x["name"]), 0) or None} for x in place["subjects"]]
    t = current_term(db, s.school_id)
    terms = []
    if t and t.session:
        for x in sorted(t.session.terms, key=lambda z: z.number):
            state = "now" if x.id == t.id else ("done" if x.number < t.number else "coming")
            item = {"name": x.name, "number": x.number, "starts_on": x.starts_on.isoformat() if x.starts_on else None, "ends_on": x.ends_on.isoformat() if x.ends_on else None, "state": state}
            if state != "coming" and x.starts_on:
                item["summary"] = term_summary(db, s, x.starts_on, min(x.ends_on or today, today))
            terms.append(item)
    else:
        from app.api.library import term_start
        terms.append({"name": "This term", "number": 1, "starts_on": term_start().isoformat(), "ends_on": None, "state": "now",
                      "summary": term_summary(db, s, term_start(), today)})
    now = None
    if t and t.starts_on and t.ends_on:
        weeks = max(1, ((t.ends_on - t.starts_on).days + 1 + 6) // 7)
        week = min(weeks, max(1, (today - t.starts_on).days // 7 + 1))
        now = {"term": t.name, "session": t.session.name, "week": week, "weeks": weeks, "days_left": max(0, (t.ends_on - today).days),
               "ends_on": t.ends_on.isoformat(), "progress": round(100 * max(0, (today - t.starts_on).days) / max(1, (t.ends_on - t.starts_on).days))}
    from app.api.assessment import published_cards
    cards = published_cards(db, s)
    by_term = {c["term_id"]: c for c in cards}
    if t and t.session:
        for item, x in zip(terms, sorted(t.session.terms, key=lambda z: z.number)):
            item["result"] = by_term.get(str(x.id))
    years = list(db.scalars(select(Enrolment).where(Enrolment.student_id == s.id).order_by(Enrolment.outcome == "current", Enrolment.ended_on.nulls_last(),
                                                                                          Enrolment.started_on.nulls_first(), Enrolment.created_at)))
    db.commit()
    return {
        "student": {"id": str(s.id), "name": s.full_name, "first_name": s.first_name, "admission_no": s.admission_no, "admitted_on": s.admitted_on.isoformat() if s.admitted_on else None,
                    "entry_class": s.entry_class, "previous_school": s.previous_school},
        "school": {"name": school.name},
        "session": t.session.name if t else academic_year(today), "sessions_set": bool(t), "now": now,
        "class": place["class"], "house": place["house"], "subjects": subjects, "clubs": place["clubs"],
        "terms": terms,
        "years": [{"id": str(e.id), "session": e.session_label, "class_name": e.class_name, "level": e.level, "school_name": e.school_name, "form_teacher": e.form_teacher,
                   "started_on": e.started_on.isoformat() if e.started_on else None, "ended_on": e.ended_on.isoformat() if e.ended_on else None,
                   "outcome": e.outcome, "outcome_label": OUTCOMES.get(e.outcome, e.outcome), "subjects": e.subjects or [], "note": e.note} for e in years],
        "results": cards,
        "can_edit": full,
    }


@router.get("/students/{student_id}/record")
def staff_record(student_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    s, a = get_student(db, user, student_id)
    return record(db, s, a.edit)


@router.get("/me/children/{student_id}/record")
def family_record(student_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    s, _ = child_for(db, user, student_id)
    out = record(db, s, False)
    out["choices"] = my_choices(db, s, user)
    return out


class YearIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    school_name: str = Field(min_length=2, max_length=150)
    session_label: str | None = Field(default=None, max_length=20)
    class_name: str | None = Field(default=None, max_length=40)
    note: str | None = Field(default=None, max_length=300)


@router.post("/students/{student_id}/record/previous", status_code=201)
def add_previous(student_id: uuid.UUID, data: YearIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """A year at a school before this one (for students who joined from elsewhere)."""
    s, _ = get_student(db, user, student_id, write=True)
    db.add(Enrolment(school_id=s.school_id, student_id=s.id, outcome="previous", subjects=[], **data.model_dump()))
    db.commit()
    return record(db, s, True)


@router.delete("/enrolments/{enrolment_id}", status_code=204)
def remove_previous(enrolment_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    e = db.get(Enrolment, enrolment_id)
    if not e or e.outcome != "previous":
        raise not_found("Entry")
    get_student(db, user, e.student_id, write=True)
    db.delete(e)
    db.commit()
    return Response(status_code=204)


# ---------- Choosing subjects ----------

def window_out(db: Session, w: SubjectChoiceWindow) -> dict:
    subs = {x.id: x for x in db.scalars(select(Subject).where(Subject.id.in_([uuid.UUID(i) for i in w.subject_ids] or [uuid.uuid4()])))}
    return {"id": str(w.id), "title": w.title, "chooser_level": w.chooser_level, "for_level": w.for_level, "min": w.min_choices, "max": w.max_choices,
            "closes_on": w.closes_on.isoformat() if w.closes_on else None, "is_open": w.is_open and (not w.closes_on or w.closes_on >= now_wat().date()), "note": w.note,
            "subjects": [{"id": i, "name": subs[uuid.UUID(i)].name} for i in w.subject_ids if uuid.UUID(i) in subs]}


def my_choices(db: Session, s: Student, user: User) -> list[dict]:
    c = db.get(SchoolClass, s.class_id) if s.class_id else None
    if not c:
        return []
    out = []
    for w in db.scalars(select(SubjectChoiceWindow).where(SubjectChoiceWindow.school_id == s.school_id, SubjectChoiceWindow.chooser_level == c.level).order_by(SubjectChoiceWindow.created_at.desc())):
        ch = db.scalar(select(SubjectChoice).where(SubjectChoice.window_id == w.id, SubjectChoice.student_id == s.id))
        wo = window_out(db, w)
        if not wo["is_open"] and not ch:
            continue
        names = {x["id"]: x["name"] for x in wo["subjects"]}
        wo["mine"] = {"subject_ids": ch.subject_ids, "status": ch.status, "approved": [names.get(i, "?") for i in ch.approved_ids or []], "note": ch.note,
                      "at": ch.updated_at.isoformat()} if ch else None
        out.append(wo)
    return out


class ChooseIn(BaseModel):
    subject_ids: list[str] = Field(max_length=12)


@router.put("/me/children/{student_id}/choices/{window_id}")
def choose(student_id: uuid.UUID, window_id: uuid.UUID, data: ChooseIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """The student (or their parent) sends their subject choices, in order of preference."""
    s, how = child_for(db, user, student_id)
    if rights.acting(user):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Nothing can be changed while seeing as someone else")
    w = db.get(SubjectChoiceWindow, window_id)
    c = db.get(SchoolClass, s.class_id) if s.class_id else None
    if not w or w.school_id != s.school_id or not c or c.level != w.chooser_level:
        raise not_found("Subject choices")
    if not window_out(db, w)["is_open"]:
        raise HTTPException(status.HTTP_409_CONFLICT, "Subject choices are closed")
    ids = list(dict.fromkeys(data.subject_ids))
    if any(i not in w.subject_ids for i in ids):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Choose from the list")
    if not (w.min_choices <= len(ids) <= w.max_choices):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Choose between {w.min_choices} and {w.max_choices} subjects")
    ch = db.scalar(select(SubjectChoice).where(SubjectChoice.window_id == w.id, SubjectChoice.student_id == s.id))
    if ch and ch.status == "approved":
        raise HTTPException(status.HTTP_409_CONFLICT, "The school has already approved your subjects. Ask your form teacher to change them.")
    if not ch:
        ch = SubjectChoice(window_id=w.id, student_id=s.id, approved_ids=[])
        db.add(ch)
    ch.subject_ids, ch.by_id, ch.status = ids, user.id, "sent"
    db.commit()
    return my_choices(db, s, user)


def need_school(db: Session, user: User, school_id: uuid.UUID) -> School:
    sc = db.get(School, school_id)
    if not sc:
        raise not_found("School")
    check(user, sc, "students")
    return sc


class WindowIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    title: str = Field(min_length=3, max_length=120)
    chooser_level: str = Field(max_length=30)
    for_level: str = Field(max_length=30)
    subject_ids: list[str] = Field(min_length=2, max_length=30)
    min_choices: int = Field(ge=1, le=10)
    max_choices: int = Field(ge=1, le=12)
    closes_on: date | None = None
    is_open: bool = True
    note: str | None = Field(default=None, max_length=600)


@router.get("/schools/{school_id}/subject-choices")
def windows(school_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    need_school(db, user, school_id)
    out = []
    for w in db.scalars(select(SubjectChoiceWindow).where(SubjectChoiceWindow.school_id == school_id).order_by(SubjectChoiceWindow.created_at.desc())):
        wo = window_out(db, w)
        students = db.scalar(select(func.count()).select_from(Student).join(SchoolClass, SchoolClass.id == Student.class_id)
                             .join(Branch, Branch.id == SchoolClass.branch_id).where(Branch.school_id == school_id, SchoolClass.level == w.chooser_level,
                                                                                     Student.status == StudentStatus.active)) or 0
        sent = db.scalar(select(func.count()).select_from(SubjectChoice).where(SubjectChoice.window_id == w.id)) or 0
        approved = db.scalar(select(func.count()).select_from(SubjectChoice).where(SubjectChoice.window_id == w.id, SubjectChoice.status == "approved")) or 0
        out.append({**wo, "students": students, "sent": sent, "approved": approved})
    subjects = [{"id": str(x.id), "name": x.name} for x in db.scalars(select(Subject).where(Subject.school_id == school_id).order_by(Subject.name))]
    levels = sorted({c.level for c in db.scalars(select(SchoolClass).join(Branch, Branch.id == SchoolClass.branch_id).where(Branch.school_id == school_id))},
                    key=lambda l: __import__("app.api.academics", fromlist=["_level_order"])._level_order(l))
    return {"windows": out, "subjects": subjects, "levels": levels}


@router.post("/schools/{school_id}/subject-choices", status_code=201)
def add_window(school_id: uuid.UUID, data: WindowIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    need_school(db, user, school_id)
    if data.min_choices > data.max_choices or data.max_choices > len(data.subject_ids):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Check the number of choices")
    w = SubjectChoiceWindow(school_id=school_id, **data.model_dump())
    db.add(w)
    db.flush()
    # Tell the students (and their parents) who choose.
    studs = db.scalars(select(Student).join(SchoolClass, SchoolClass.id == Student.class_id).join(Branch, Branch.id == SchoolClass.branch_id)
                       .where(Branch.school_id == school_id, SchoolClass.level == data.chooser_level, Student.status == StudentStatus.active))
    for s in studs:
        for uid in ({s.user_id} if s.user_id else set()) | {g.user_id for g in s.guardians}:
            db.add(Notice(user_id=uid, school_id=school_id, kind="request", icon="book-text",
                          text=f"Time to choose {s.first_name}'s subjects for {data.for_level}: {data.title}." + (f" Closes {data.closes_on:%d %b}." if data.closes_on else ""),
                          link=f"#/child/{s.id}"))
    db.commit()
    return window_out(db, w)


@router.put("/subject-choice-windows/{window_id}")
def edit_window(window_id: uuid.UUID, data: WindowIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    w = db.get(SubjectChoiceWindow, window_id)
    if not w:
        raise not_found("Subject choices")
    need_school(db, user, w.school_id)
    for k, v in data.model_dump().items():
        setattr(w, k, v)
    db.commit()
    return window_out(db, w)


@router.get("/subject-choice-windows/{window_id}")
def window_detail(window_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    w = db.get(SubjectChoiceWindow, window_id)
    if not w:
        raise not_found("Subject choices")
    need_school(db, user, w.school_id)
    wo = window_out(db, w)
    names = {x["id"]: x["name"] for x in wo["subjects"]}
    studs = list(db.scalars(select(Student).join(SchoolClass, SchoolClass.id == Student.class_id).join(Branch, Branch.id == SchoolClass.branch_id)
                            .where(Branch.school_id == w.school_id, SchoolClass.level == w.chooser_level, Student.status == StudentStatus.active)
                            .order_by(SchoolClass.arm, Student.last_name)))
    chs = {c.student_id: c for c in db.scalars(select(SubjectChoice).where(SubjectChoice.window_id == w.id))}
    first = Counter(); anyc = Counter()
    rows = []
    for s in studs:
        ch = chs.get(s.id)
        if ch:
            if ch.subject_ids:
                first[ch.subject_ids[0]] += 1
            for i in (ch.approved_ids if ch.status == "approved" else ch.subject_ids):
                anyc[i] += 1
        rows.append({"id": str(s.id), "name": s.full_name, "class_name": s.school_class.name if s.school_class else None, "thumb": s.photo_thumb,
                     "choice": {"id": str(ch.id), "subjects": [names.get(i, "?") for i in ch.subject_ids], "subject_ids": ch.subject_ids, "status": ch.status,
                                "approved": ch.approved_ids, "note": ch.note} if ch else None})
    wo["students"] = sorted(rows, key=lambda r: 0 if r["choice"] and r["choice"]["status"] == "sent" else 1 if r["choice"] else 2)
    wo["demand"] = sorted([{"id": i, "name": n, "students": anyc.get(i, 0), "first": first.get(i, 0)} for i, n in names.items()], key=lambda x: -x["students"])
    wo["sent"] = len(chs)
    return wo


class DecideIn(BaseModel):
    subject_ids: list[str] = Field(max_length=12)
    note: str | None = Field(default=None, max_length=300)


@router.post("/subject-choices/{choice_id}/approve")
def approve(choice_id: uuid.UUID, data: DecideIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    ch = db.get(SubjectChoice, choice_id)
    if not ch:
        raise not_found("Choice")
    w = db.get(SubjectChoiceWindow, ch.window_id)
    school = need_school(db, user, w.school_id)
    if not rights.has(user, school, "students.change", db) or rights.acting(user):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only people who can change students can approve subjects")
    if any(i not in w.subject_ids for i in data.subject_ids):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Choose from the list")
    ch.approved_ids, ch.status, ch.note = list(dict.fromkeys(data.subject_ids)), "approved", data.note
    s = db.get(Student, ch.student_id)
    c = db.get(SchoolClass, s.class_id) if s.class_id else None
    applied = apply_choices(db, s) if c and c.level == w.for_level else 0
    names = {x["id"]: x["name"] for x in window_out(db, w)["subjects"]}
    text = f"{s.first_name}'s subjects for {w.for_level} are approved: {', '.join(names.get(i, '?') for i in ch.approved_ids)}." + (f" “{data.note}”" if data.note else "")
    for uid in ({s.user_id} if s.user_id else set()) | {g.user_id for g in s.guardians}:
        db.add(Notice(user_id=uid, school_id=w.school_id, kind="info", icon="book-text", text=text[:400], link=f"#/child/{s.id}"))
    db.commit()
    return {"status": ch.status, "applied": applied}


@router.post("/subject-choice-windows/{window_id}/approve-all")
def approve_all(window_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Approve everyone's first choices as they are (for schools where every choice can be met)."""
    w = db.get(SubjectChoiceWindow, window_id)
    if not w:
        raise not_found("Subject choices")
    school = need_school(db, user, w.school_id)
    if not rights.has(user, school, "students.change", db) or rights.acting(user):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only people who can change students can approve subjects")
    n = 0
    for ch in db.scalars(select(SubjectChoice).where(SubjectChoice.window_id == w.id, SubjectChoice.status == "sent")):
        approve(ch.id, DecideIn(subject_ids=ch.subject_ids), user, db)
        n += 1
    return {"approved": n}
