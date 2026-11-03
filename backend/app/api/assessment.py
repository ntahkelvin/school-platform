"""Assessment: homework and assignments, score sheets (CA and exam), broadsheets, report cards and publishing results.

Who can do what
- A subject teacher fills the score sheet for the classes (or elective groups) they teach, and sets and marks homework.
  Once they hand the sheet in, it is locked for them; someone with "Scores and results: change" can reopen it.
- A form teacher sees the broadsheet for their class, rates each student's habits and writes the class teacher's comment.
- People with "Scores and results" (the principal and vice principal by default) see every sheet and broadsheet,
  write the principal's comment and publish report cards. Publishing tells the student and their parents.
- Students and parents see homework (students hand it in), marks and feedback, and report cards once published.
"""
import random
import secrets
import uuid
from collections import defaultdict
from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.api.access import not_found
from app.api.deps import current_user
from app.api.family import child_for
from app.api.records import current_term
from app.api.staff_day import now_wat
from app.api.student360 import name_of
from app.core import rights
from app.core.db import get_db
from app.models import (
    AcademicSession, Assignment, AttendanceRecord, Branch, ClassSubject, ConductEntry, GradingScale, Notice, ReportCard, School, SchoolClass,
    House, Score, Section, SheetStatus, Student, StudentElective, Subject, Submission, TeachingGroup, Term, User, AssessmentScheme,
)
from app.models.attendance import AttendanceKind, AttendanceStatus
from app.models.people import StudentStatus

router = APIRouter(prefix="/api", tags=["assessment"])

DEFAULT_SCHEME = [{"name": "CA1", "max": 20, "parts": []}, {"name": "CA2", "max": 20, "parts": []}, {"name": "Exam", "max": 60, "parts": []}]
DEFAULT_BANDS = [("A1", 75, 100, "Excellent"), ("B2", 70, 74, "Very good"), ("B3", 65, 69, "Good"), ("C4", 60, 64, "Credit"), ("C5", 55, 59, "Credit"),
                 ("C6", 50, 54, "Credit"), ("D7", 45, 49, "Pass"), ("E8", 40, 44, "Pass"), ("F9", 0, 39, "Fail")]
TRAITS = {"Habits": ["Punctuality", "Neatness", "Politeness", "Honesty", "Self-control", "Relationship with others", "Attentiveness"],
          "Skills": ["Handwriting", "Sports and games", "Creative arts", "Use of computers", "Verbal fluency"]}
TRAIT_WORDS = {5: "Excellent", 4: "Very good", 3: "Good", 2: "Fair", 1: "Needs work"}
KINDS = {"homework": "Homework", "classwork": "Classwork", "project": "Project", "test": "Class test"}


# ---------- Helpers ----------

def ordinal(n: int) -> str:
    return f"{n}{'th' if 10 <= n % 100 <= 20 else {1: 'st', 2: 'nd', 3: 'rd'}.get(n % 10, 'th')}"


def rank(values: dict) -> dict:
    """Positions with ties sharing a place: {id: "1st" | "=2nd"}."""
    order = sorted(((v, k) for k, v in values.items() if v is not None), key=lambda x: -x[0])
    out, counts = {}, defaultdict(int)
    for v, _ in order:
        counts[round(v, 2)] += 1
    pos, prev, place = 0, None, 0
    for v, k in order:
        pos += 1
        if prev is None or round(v, 2) != prev:
            place, prev = pos, round(v, 2)
        out[k] = ("=" if counts[round(v, 2)] > 1 else "") + ordinal(place)
    return out


def school_of_class(db: Session, c: SchoolClass) -> School:
    return db.get(School, db.get(Branch, c.branch_id).school_id)


def section_for(db: Session, school_id: uuid.UUID, level: str | None) -> Section | None:
    for s in db.scalars(select(Section).where(Section.school_id == school_id)):
        if level and level in (s.levels or []):
            return s
    return None


def scheme_for(db: Session, school_id: uuid.UUID, level: str | None) -> list[dict]:
    sec = section_for(db, school_id, level)
    sch = db.get(AssessmentScheme, sec.assessment_scheme_id) if sec and sec.assessment_scheme_id else None
    if not sch:
        sch = db.scalar(select(AssessmentScheme).where(AssessmentScheme.school_id == school_id).order_by(AssessmentScheme.created_at))
    if not sch or not sch.components:
        return DEFAULT_SCHEME
    return [{"name": c.name, "max": c.max_score, "parts": [{"name": p["name"], "max": p["max_score"]} for p in (c.parts or [])]} for c in sch.components]


def columns_of(scheme: list[dict]) -> list[dict]:
    cols = []
    for c in scheme:
        if c["parts"]:
            for p in c["parts"]:
                cols.append({"key": f"{c['name']} › {p['name']}", "label": p["name"], "group": c["name"], "max": p["max"]})
        else:
            cols.append({"key": c["name"], "label": c["name"], "group": None, "max": c["max"]})
    return cols


def bands_for(db: Session, school_id: uuid.UUID, level: str | None) -> list[tuple]:
    sec = section_for(db, school_id, level)
    sc = db.get(GradingScale, sec.grading_scale_id) if sec and sec.grading_scale_id else None
    if not sc:
        sc = db.scalar(select(GradingScale).where(GradingScale.school_id == school_id).order_by(GradingScale.created_at))
    return [(b.grade, b.min_score, b.max_score, b.remark) for b in sc.bands] if sc and sc.bands else DEFAULT_BANDS


def grade_of(total: float | None, bands: list[tuple]) -> tuple[str | None, str | None]:
    if total is None:
        return None, None
    t = int(round(total))
    for g, lo, hi, remark in bands:
        if lo <= t <= hi:
            return g, remark
    return None, None


def need_term(db: Session, school_id: uuid.UUID, term_id: uuid.UUID | None) -> Term:
    if term_id:
        t = db.get(Term, term_id)
        if not t or db.get(AcademicSession, t.session_id).school_id != school_id:
            raise not_found("Term")
        return t
    t = current_term(db, school_id)
    if not t:
        raise HTTPException(status.HTTP_409_CONFLICT, "Set up the session and terms first (Classes, sessions and terms), and choose the current term.")
    return t


def term_out(t: Term) -> dict:
    return {"id": str(t.id), "name": t.name, "number": t.number, "session": t.session.name, "starts_on": t.starts_on.isoformat() if t.starts_on else None,
            "ends_on": t.ends_on.isoformat() if t.ends_on else None, "terms": [{"id": str(x.id), "name": x.name, "number": x.number} for x in t.session.terms]}


def next_term_start(db: Session, t: Term) -> str | None:
    later = [x for x in t.session.terms if x.number > t.number]
    if later:
        return later[0].starts_on.isoformat() if later[0].starts_on else None
    nxt = db.scalar(select(AcademicSession).where(AcademicSession.school_id == t.session.school_id, AcademicSession.name > t.session.name).order_by(AcademicSession.name))
    return nxt.terms[0].starts_on.isoformat() if nxt and nxt.terms and nxt.terms[0].starts_on else None


def notify(db: Session, user_ids, school_id, text: str, link: str | None, icon: str = "chart", kind: str = "info") -> None:
    for uid in {u for u in user_ids if u}:
        db.add(Notice(user_id=uid, school_id=school_id, kind=kind, icon=icon, text=text[:400], link=link))


def family_of(s: Student) -> set:
    return ({s.user_id} if s.user_id else set()) | {g.user_id for g in s.guardians}


# ---------- Who is on a sheet ----------

class Scope:
    """A score sheet or homework audience: one subject for one class, or one elective group."""
    def __init__(self, db: Session, key: str):
        self.key = key
        bits = key.split(":")
        try:
            if bits[0] == "class" and len(bits) == 3:
                self.kind, self.cls, self.subject = "class", db.get(SchoolClass, uuid.UUID(bits[1])), db.get(Subject, uuid.UUID(bits[2]))
                self.group = None
                if not self.cls or not self.subject:
                    raise ValueError
                self.cs = db.scalar(select(ClassSubject).where(ClassSubject.class_id == self.cls.id, ClassSubject.subject_id == self.subject.id))
                self.level, self.teacher_id = self.cls.level, self.cs.teacher_user_id if self.cs else None
                self.name = self.cls.name
            elif bits[0] == "group" and len(bits) == 2:
                self.kind, self.group = "group", db.get(TeachingGroup, uuid.UUID(bits[1]))
                if not self.group:
                    raise ValueError
                self.cls, self.cs, self.subject = None, None, db.get(Subject, self.group.subject_id)
                self.level, self.teacher_id, self.name = self.group.level, self.group.teacher_user_id, self.group.name
            else:
                raise ValueError
        except ValueError:
            raise not_found("Score sheet")
        self.school = school_of_class(db, self.cls) if self.cls else db.get(School, db.get(Branch, self.group.branch_id).school_id)
        self.db = db

    def students(self) -> list[Student]:
        db = self.db
        q = select(Student).where(Student.status == StudentStatus.active)
        if self.kind == "group":
            q = q.join(StudentElective, StudentElective.student_id == Student.id).where(StudentElective.group_id == self.group.id)
        elif self.cs and self.cs.compulsory:
            q = q.where(Student.class_id == self.cls.id)
        else:
            q = q.join(StudentElective, StudentElective.student_id == Student.id).where(Student.class_id == self.cls.id, StudentElective.subject_id == self.subject.id)
        return list(db.scalars(q.order_by(Student.last_name, Student.first_name)).unique())

    def title(self) -> str:
        return f"{self.subject.name} · {self.name}"

    def can_see(self, user: User) -> bool:
        if self.teacher_id == user.id or rights.has(user, self.school, "results.see", self.db):
            return True
        return bool(self.cls and self.cls.form_teacher_id == user.id)

    def is_teacher(self, user: User) -> bool:
        return self.teacher_id == user.id and not rights.acting(user)

    def manager(self, user: User) -> bool:
        return rights.has(user, self.school, "results.change", self.db) and not rights.acting(user)


def my_scopes(db: Session, user: User) -> list[str]:
    keys = [f"class:{cs.class_id}:{cs.subject_id}" for cs in db.scalars(select(ClassSubject).where(ClassSubject.teacher_user_id == user.id))]
    keys += [f"group:{g.id}" for g in db.scalars(select(TeachingGroup).where(TeachingGroup.teacher_user_id == user.id))]
    return keys


def student_scopes(db: Session, s: Student) -> list[tuple[str, uuid.UUID]]:
    """The class subjects and elective groups this student is in: [(scope key, subject id)]."""
    out = []
    if s.class_id:
        mine = set(db.scalars(select(StudentElective.subject_id).where(StudentElective.student_id == s.id)))
        for cs in db.scalars(select(ClassSubject).where(ClassSubject.class_id == s.class_id)):
            if cs.compulsory or cs.subject_id in mine:
                out.append((f"class:{s.class_id}:{cs.subject_id}", cs.subject_id))
    for el in db.scalars(select(StudentElective).where(StudentElective.student_id == s.id, StudentElective.group_id.is_not(None))):
        out.append((f"group:{el.group_id}", el.subject_id))
    return out


# ---------- Score sheets ----------

def sheet_status(db: Session, term: Term, key: str) -> SheetStatus | None:
    return db.scalar(select(SheetStatus).where(SheetStatus.term_id == term.id, SheetStatus.scope == key))


def totals_for(scheme: list[dict], marks: dict) -> tuple[float | None, dict]:
    """Total out of 100 and each component's total, from {column key: value}."""
    comp, any_mark = {}, False
    for c in scheme:
        keys = [f"{c['name']} › {p['name']}" for p in c["parts"]] or [c["name"]]
        vals = [marks.get(k) for k in keys]
        if any(v is not None for v in vals):
            any_mark = True
        comp[c["name"]] = round(sum(v or 0 for v in vals), 1) if any(v is not None for v in vals) else None
    return (round(sum(v or 0 for v in comp.values()), 1) if any_mark else None), comp


def sheet(db: Session, sc: Scope, term: Term, user: User) -> dict:
    scheme = scheme_for(db, sc.school.id, sc.level)
    cols = columns_of(scheme)
    bands = bands_for(db, sc.school.id, sc.level)
    studs = sc.students()
    ids = [s.id for s in studs]
    marks: dict = defaultdict(dict)
    absent: dict = defaultdict(dict)
    for r in db.scalars(select(Score).where(Score.term_id == term.id, Score.subject_id == sc.subject.id, Score.student_id.in_(ids or [uuid.uuid4()]))):
        marks[r.student_id][r.component] = r.value
        if r.absent:
            absent[r.student_id][r.component] = True
    st = sheet_status(db, term, sc.key)
    rows, totals = [], {}
    for s in studs:
        total, comp = totals_for(scheme, marks[s.id])
        totals[s.id] = total
        g, remark = grade_of(total, bands)
        filled = sum(1 for c in cols if marks[s.id].get(c["key"]) is not None or absent[s.id].get(c["key"]))
        rows.append({"id": str(s.id), "name": f"{s.last_name}, {s.first_name}", "first_name": s.first_name, "admission_no": s.admission_no, "thumb": s.photo_thumb,
                     "class_name": s.school_class.name if s.school_class else None,
                     "marks": {k: v for k, v in marks[s.id].items()}, "absent": list(absent[s.id]), "components": comp, "total": total, "grade": g, "remark": remark, "filled": filled})
    pos = rank({r["id"]: r["total"] for r in rows})
    for r in rows:
        r["position"] = pos.get(r["id"])
    got = [r["total"] for r in rows if r["total"] is not None]
    passmark = min((lo for g, lo, hi, rm in bands if rm.lower() not in ("fail",) and lo > 0), default=40)
    gradecount = defaultdict(int)
    for r in rows:
        if r["grade"]:
            gradecount[r["grade"]] += 1
    submitted = st and st.status == "submitted"
    homework = [{"id": str(a.id), "title": a.title, "kind": a.kind, "max_score": a.max_score, "counts_to": a.counts_to,
                 "marked": db.scalar(select(func.count()).select_from(Submission).where(Submission.assignment_id == a.id, Submission.score.is_not(None))) or 0}
                for a in db.scalars(assignments_query(sc, term).where(Assignment.max_score.is_not(None)).order_by(Assignment.set_on.desc()))]
    return {
        "scope": sc.key, "title": sc.title(), "subject": {"id": str(sc.subject.id), "name": sc.subject.name}, "group": sc.name, "level": sc.level,
        "class_id": str(sc.cls.id) if sc.cls else None, "school_id": str(sc.school.id), "teacher": name_of(db, sc.teacher_id),
        "term": term_out(term), "scheme": scheme, "columns": cols, "bands": [{"grade": g, "min": lo, "max": hi, "remark": rm} for g, lo, hi, rm in bands],
        "students": rows, "status": st.status if st else "open", "status_note": st.note if st else None, "submitted_at": st.updated_at.isoformat() if submitted else None,
        "submitted_by": name_of(db, st.by_id) if submitted else None,
        "can_edit": (sc.is_teacher(user) and not submitted) or sc.manager(user), "can_reopen": bool(submitted and sc.manager(user)), "is_teacher": sc.teacher_id == user.id,
        "stats": {"average": round(sum(got) / len(got), 1) if got else None, "highest": max(got) if got else None, "lowest": min(got) if got else None,
                  "passed": sum(1 for x in got if x >= passmark), "scored": len(got), "students": len(rows), "complete": sum(1 for r in rows if r["filled"] == len(cols)),
                  "grades": dict(gradecount), "pass_mark": passmark},
        "homework": homework,
    }


def open_scope(db: Session, user: User, key: str) -> Scope:
    sc = Scope(db, key)
    if not sc.can_see(user):
        raise not_found("Score sheet")
    return sc


@router.get("/me/score-sheets")
def my_sheets(term_id: uuid.UUID | None = None, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """The score sheets this teacher fills, with how far each one has got."""
    out, terms = [], {}
    for key in my_scopes(db, user):
        sc = Scope(db, key)
        try:
            t = terms.get(sc.school.id) or need_term(db, sc.school.id, term_id)
        except HTTPException:
            continue
        terms[sc.school.id] = t
        studs = [s.id for s in sc.students()]
        if not studs:
            continue
        cols = columns_of(scheme_for(db, sc.school.id, sc.level))
        n = db.scalar(select(func.count()).select_from(Score).where(Score.term_id == t.id, Score.subject_id == sc.subject.id, Score.student_id.in_(studs),
                                                                    or_(Score.value.is_not(None), Score.absent.is_(True)))) or 0
        st = sheet_status(db, t, key)
        out.append({"scope": key, "subject": sc.subject.name, "group": sc.name, "level": sc.level, "students": len(studs), "progress": round(100 * n / (len(studs) * len(cols))),
                    "status": st.status if st else "open", "term": t.name, "term_id": str(t.id), "school_id": str(sc.school.id)})
    out.sort(key=lambda x: (x["status"] == "submitted", x["level"] or "", x["group"], x["subject"]))
    return out


@router.get("/score-sheets/{scope}")
def get_sheet(scope: str, term_id: uuid.UUID | None = None, user: User = Depends(current_user), db: Session = Depends(get_db)):
    sc = open_scope(db, user, scope)
    return sheet(db, sc, need_term(db, sc.school.id, term_id), user)


class MarkIn(BaseModel):
    student_id: uuid.UUID
    key: str = Field(max_length=80)
    value: float | None = Field(default=None, ge=0, le=100)
    absent: bool = False


class MarksIn(BaseModel):
    term_id: uuid.UUID
    marks: list[MarkIn] = Field(max_length=3000)


def save_marks(db: Session, sc: Scope, term: Term, marks: list[MarkIn], user: User) -> None:
    cols = {c["key"]: c for c in columns_of(scheme_for(db, sc.school.id, sc.level))}
    allowed = {s.id for s in sc.students()}
    have = {(r.student_id, r.component): r for r in db.scalars(select(Score).where(Score.term_id == term.id, Score.subject_id == sc.subject.id,
                                                                                  Score.student_id.in_(list(allowed) or [uuid.uuid4()])))}
    for m in marks:
        if m.key not in cols:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"There is no column called {m.key}")
        if m.student_id not in allowed:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "That student is not on this sheet")
        if m.value is not None and m.value > cols[m.key]["max"]:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"{m.key} is out of {cols[m.key]['max']}")
        r = have.get((m.student_id, m.key))
        if m.value is None and not m.absent:
            if r:
                db.delete(r)
                have.pop((m.student_id, m.key))
            continue
        if not r:
            r = Score(term_id=term.id, student_id=m.student_id, subject_id=sc.subject.id, component=m.key)
            db.add(r)
            have[(m.student_id, m.key)] = r
        r.value, r.absent, r.by_id = (None if m.absent else round(m.value, 1)), m.absent, user.id


@router.put("/score-sheets/{scope}")
def put_marks(scope: str, data: MarksIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    sc = open_scope(db, user, scope)
    term = need_term(db, sc.school.id, data.term_id)
    st = sheet_status(db, term, sc.key)
    if not (sc.manager(user) or (sc.is_teacher(user) and not (st and st.status == "submitted"))):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This sheet has been handed in. Ask the principal to reopen it." if st and st.status == "submitted"
                            else "Only the subject teacher can fill this sheet")
    if db.scalar(select(ReportCard.id).join(Student, Student.id == ReportCard.student_id).where(ReportCard.term_id == term.id, ReportCard.status == "published",
                                                                                            ReportCard.student_id.in_([m.student_id for m in data.marks] or [uuid.uuid4()]))):
        raise HTTPException(status.HTTP_409_CONFLICT, "Report cards for some of these students are already published. Take them back first.")
    save_marks(db, sc, term, data.marks, user)
    db.commit()
    return sheet(db, sc, term, user)


class SubmitIn(BaseModel):
    term_id: uuid.UUID
    even_if_missing: bool = False
    note: str | None = Field(default=None, max_length=300)


@router.post("/score-sheets/{scope}/submit")
def submit_sheet(scope: str, data: SubmitIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    sc = open_scope(db, user, scope)
    if not (sc.is_teacher(user) or sc.manager(user)):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the subject teacher can hand in this sheet")
    term = need_term(db, sc.school.id, data.term_id)
    sh = sheet(db, sc, term, user)
    missing = sh["stats"]["students"] - sh["stats"]["complete"]
    if missing and not data.even_if_missing:
        raise HTTPException(status.HTTP_409_CONFLICT, f"{missing} student{'s' if missing != 1 else ''} still {'have' if missing != 1 else 'has'} empty marks")
    st = sheet_status(db, term, sc.key) or SheetStatus(term_id=term.id, scope=sc.key)
    st.status, st.by_id, st.note = "submitted", user.id, data.note
    db.add(st)
    who = set()
    if sc.cls and sc.cls.form_teacher_id:
        who.add(sc.cls.form_teacher_id)
    elif sc.group:
        who |= {c.form_teacher_id for c in db.scalars(select(SchoolClass).join(Student, Student.class_id == SchoolClass.id)
                                                       .join(StudentElective, StudentElective.student_id == Student.id).where(StudentElective.group_id == sc.group.id))}
    who.discard(user.id)
    notify(db, who, sc.school.id, f"{name_of(db, user.id)} handed in the {sc.title()} scores for {term.name}.", f"#/results/{sc.cls.id}" if sc.cls else None, "circle-check")
    db.commit()
    return sheet(db, sc, term, user)


class ReopenIn(BaseModel):
    term_id: uuid.UUID
    note: str | None = Field(default=None, max_length=300)


@router.post("/score-sheets/{scope}/reopen")
def reopen_sheet(scope: str, data: ReopenIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    sc = open_scope(db, user, scope)
    if not sc.manager(user):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only someone who can change results can reopen a sheet")
    term = need_term(db, sc.school.id, data.term_id)
    st = sheet_status(db, term, sc.key)
    if st:
        st.status, st.note, st.by_id = "open", data.note, user.id
    notify(db, [sc.teacher_id], sc.school.id, f"Your {sc.title()} score sheet is open again" + (f": “{data.note}”" if data.note else "."), f"#/sheet/{sc.key}", "refresh", "request")
    db.commit()
    return sheet(db, sc, term, user)


# ---------- Homework and assignments ----------

def assignments_query(sc: Scope, term: Term | None = None):
    q = select(Assignment).where(Assignment.subject_id == sc.subject.id)
    q = q.where(Assignment.group_id == sc.group.id) if sc.kind == "group" else q.where(Assignment.class_id == sc.cls.id)
    return q.where(Assignment.term_id == term.id) if term else q


def scope_of(db: Session, a: Assignment) -> Scope:
    return Scope(db, f"group:{a.group_id}" if a.group_id else f"class:{a.class_id}:{a.subject_id}")


def due_label(a: Assignment, today: date) -> str:
    if not a.due_on:
        return "No date"
    d = (a.due_on - today).days
    return "Due today" if d == 0 else "Due tomorrow" if d == 1 else f"Due in {d} days" if 1 < d < 7 else f"Due {a.due_on:%a %d %b}" if d >= 7 else f"Was due {a.due_on:%d %b}"


def assignment_out(db: Session, a: Assignment, sc: Scope, counts: bool = True) -> dict:
    out = {"id": str(a.id), "scope": sc.key, "kind": a.kind, "kind_label": KINDS.get(a.kind, a.kind), "title": a.title, "instructions": a.instructions, "link": a.link,
           "set_on": a.set_on.isoformat(), "due_on": a.due_on.isoformat() if a.due_on else None, "due": due_label(a, now_wat().date()), "max_score": a.max_score,
           "online": a.online, "counts_to": a.counts_to, "subject": sc.subject.name, "group": sc.name, "teacher": name_of(db, a.teacher_id)}
    if counts:
        rows = list(db.execute(select(Submission.status, func.count()).where(Submission.assignment_id == a.id).group_by(Submission.status)))
        c = dict(rows)
        out.update({"students": len(sc.students()), "handed_in": c.get("handed_in", 0) + c.get("marked", 0), "to_mark": c.get("handed_in", 0), "marked": c.get("marked", 0),
                    "missing": c.get("missing", 0)})
    return out


class AssignmentIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    scope: str = Field(max_length=120)
    kind: str = Field(pattern="^(homework|classwork|project|test)$")
    title: str = Field(min_length=3, max_length=150)
    instructions: str | None = Field(default=None, max_length=5000)
    link: str | None = Field(default=None, max_length=500)
    due_on: date | None = None
    max_score: int | None = Field(default=None, ge=1, le=100)
    online: bool = True


@router.get("/me/assignments")
def my_assignments(user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Homework this teacher has set, newest first, and the classes they can set it for."""
    keys = my_scopes(db, user)
    scopes = []
    for k in keys:
        sc = Scope(db, k)
        scopes.append({"scope": k, "title": sc.title(), "subject": sc.subject.name, "group": sc.name, "level": sc.level})
    conds = [Assignment.teacher_id == user.id]
    for k in keys:
        b = k.split(":")
        conds.append(Assignment.group_id == uuid.UUID(b[1]) if b[0] == "group" else (Assignment.class_id == uuid.UUID(b[1])) & (Assignment.subject_id == uuid.UUID(b[2])))
    q = select(Assignment).where(or_(*conds)).order_by(Assignment.set_on.desc(), Assignment.created_at.desc()).limit(80)
    items = [assignment_out(db, a, scope_of(db, a)) for a in db.scalars(q)]
    return {"assignments": items, "scopes": sorted(scopes, key=lambda x: (x["level"] or "", x["group"], x["subject"])), "kinds": KINDS}


@router.post("/assignments", status_code=201)
def add_assignment(data: AssignmentIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    sc = open_scope(db, user, data.scope)
    if not (sc.is_teacher(user) or sc.manager(user)):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the subject teacher can set work for this class")
    term = current_term(db, sc.school.id)
    a = Assignment(school_id=sc.school.id, class_id=sc.cls.id if sc.cls else None, group_id=sc.group.id if sc.group else None, subject_id=sc.subject.id,
                   term_id=term.id if term else None, teacher_id=user.id, set_on=now_wat().date(), **data.model_dump(exclude={"scope"}))
    db.add(a)
    db.flush()
    due = f", due {a.due_on:%a %d %b}" if a.due_on else ""
    notify(db, [s.user_id for s in sc.students()], sc.school.id, f"New {KINDS[a.kind].lower()} in {sc.subject.name}: {a.title}{due}.", None, "notebook", "request")
    db.commit()
    return assignment_out(db, a, sc)


def own_assignment(db: Session, user: User, aid: uuid.UUID, write: bool = False) -> tuple[Assignment, Scope]:
    a = db.get(Assignment, aid)
    if not a:
        raise not_found("Assignment")
    sc = scope_of(db, a)
    if not sc.can_see(user) and a.teacher_id != user.id:
        raise not_found("Assignment")
    if write and not (a.teacher_id == user.id or sc.is_teacher(user) or sc.manager(user)) or (write and rights.acting(user)):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the teacher who set this can change it")
    return a, sc


@router.get("/assignments/{aid}")
def get_assignment(aid: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    a, sc = own_assignment(db, user, aid)
    subs = {x.student_id: x for x in db.scalars(select(Submission).where(Submission.assignment_id == a.id))}
    today = now_wat().date()
    rows = []
    for s in sc.students():
        x = subs.get(s.id)
        late = bool(x and x.handed_in_at and a.due_on and x.handed_in_at.date() > a.due_on)
        state = x.status if x else ("not_yet" if not a.due_on or a.due_on >= today else "not_in")
        rows.append({"id": str(s.id), "name": f"{s.last_name}, {s.first_name}", "thumb": s.photo_thumb, "has_login": bool(s.user_id), "state": state, "late": late,
                     "text": x.text if x else None, "link": x.link if x else None, "handed_in_at": x.handed_in_at.isoformat() if x and x.handed_in_at else None,
                     "score": x.score if x else None, "feedback": x.feedback if x else None})
    out = assignment_out(db, a, sc)
    cols = columns_of(scheme_for(db, sc.school.id, sc.level))
    term = db.get(Term, a.term_id) if a.term_id else None
    st = sheet_status(db, term, sc.key) if term else None
    out.update({"rows": rows, "can_edit": a.teacher_id == user.id or sc.is_teacher(user) or sc.manager(user), "columns": [c for c in cols if "exam" not in c["key"].lower()],
                "sheet_open": bool(term) and not (st and st.status == "submitted")})
    return out


@router.put("/assignments/{aid}")
def edit_assignment(aid: uuid.UUID, data: AssignmentIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    a, sc = own_assignment(db, user, aid, write=True)
    for k, v in data.model_dump(exclude={"scope"}).items():
        setattr(a, k, v)
    db.commit()
    return assignment_out(db, a, sc)


@router.delete("/assignments/{aid}", status_code=204)
def delete_assignment(aid: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    a, _ = own_assignment(db, user, aid, write=True)
    db.delete(a)
    db.commit()
    return Response(status_code=204)


class SubMarkIn(BaseModel):
    student_id: uuid.UUID
    state: str = Field(pattern="^(marked|missing|excused|handed_in|clear)$")
    score: float | None = Field(default=None, ge=0, le=100)
    feedback: str | None = Field(default=None, max_length=600)


class SubMarksIn(BaseModel):
    marks: list[SubMarkIn] = Field(max_length=200)


@router.post("/assignments/{aid}/marks")
def mark_assignment(aid: uuid.UUID, data: SubMarksIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    a, sc = own_assignment(db, user, aid, write=True)
    allowed = {s.id for s in sc.students()}
    subs = {x.student_id: x for x in db.scalars(select(Submission).where(Submission.assignment_id == a.id))}
    now = datetime.now(timezone.utc)
    for m in data.marks:
        if m.student_id not in allowed:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "That student is not in this class")
        if m.score is not None and a.max_score and m.score > a.max_score:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"The most is {a.max_score}")
        x = subs.get(m.student_id)
        if m.state == "clear":
            if x and not x.handed_in_at:
                db.delete(x)
            elif x:
                x.status, x.score, x.feedback = "handed_in", None, None
            continue
        if not x:
            x = Submission(assignment_id=a.id, student_id=m.student_id)
            db.add(x)
            subs[m.student_id] = x
        was = (x.status, x.score, x.feedback)
        x.status, x.score, x.feedback = m.state, (m.score if m.state == "marked" else 0 if m.state == "missing" and a.max_score else None), m.feedback
        x.marked_by_id, x.marked_at = user.id, now
        if m.state == "marked" and was != (x.status, x.score, x.feedback):
            s = db.get(Student, m.student_id)
            mark = f" {x.score:g}/{a.max_score}" if x.score is not None and a.max_score else ""
            notify(db, [s.user_id], sc.school.id, f"Your {sc.subject.name} {KINDS[a.kind].lower()} “{a.title}” is marked:{mark}" + (f" “{m.feedback}”" if m.feedback else ""), None, "circle-check")
    db.commit()
    return get_assignment(aid, user, db)


class ToSheetIn(BaseModel):
    key: str = Field(max_length=80)


@router.post("/assignments/{aid}/to-sheet")
def to_sheet(aid: uuid.UUID, data: ToSheetIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Put the marks into a CA column of the score sheet, scaled to that column (e.g. 8/10 into a 20-mark CA1 is 16)."""
    a, sc = own_assignment(db, user, aid, write=True)
    if not a.max_score or not a.term_id:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Only marked work with a score can go on the score sheet")
    term = db.get(Term, a.term_id)
    cols = {c["key"]: c for c in columns_of(scheme_for(db, sc.school.id, sc.level))}
    if data.key not in cols:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Choose a column")
    st = sheet_status(db, term, sc.key)
    if st and st.status == "submitted" and not sc.manager(user):
        raise HTTPException(status.HTTP_409_CONFLICT, "The score sheet has been handed in")
    mx = cols[data.key]["max"]
    marks = [MarkIn(student_id=x.student_id, key=data.key, value=round(x.score * mx / a.max_score, 1))
             for x in db.scalars(select(Submission).where(Submission.assignment_id == a.id, Submission.score.is_not(None)))]
    save_marks(db, sc, term, marks, user)
    a.counts_to = data.key
    db.commit()
    return {"sent": len(marks), "key": data.key}


# ---------- Homework for students and parents ----------

def homework_for(db: Session, s: Student, can_act: bool) -> dict:
    scopes = student_scopes(db, s)
    if not scopes:
        return {"items": [], "can_act": can_act}
    conds = []
    for k, sub in scopes:
        b = k.split(":")
        conds.append((Assignment.group_id == uuid.UUID(b[1])) if b[0] == "group" else ((Assignment.class_id == uuid.UUID(b[1])) & (Assignment.subject_id == sub)))
    today = now_wat().date()
    items = []
    since = date(today.year - 1, today.month, 1)
    for a in db.scalars(select(Assignment).where(or_(*conds), Assignment.set_on >= since).order_by(Assignment.due_on.desc().nulls_last(), Assignment.created_at.desc()).limit(60)):
        x = db.scalar(select(Submission).where(Submission.assignment_id == a.id, Submission.student_id == s.id))
        sub = db.get(Subject, a.subject_id)
        if x and x.status == "marked":
            state = "marked"
        elif x and x.status in ("missing", "excused"):
            state = x.status
        elif x and x.handed_in_at:
            state = "handed_in"
        else:
            state = "todo" if not a.due_on or a.due_on >= today else "late"
        items.append({"id": str(a.id), "kind": a.kind, "kind_label": KINDS.get(a.kind, a.kind), "title": a.title, "instructions": a.instructions, "link": a.link,
                      "subject": sub.name, "teacher": name_of(db, a.teacher_id), "set_on": a.set_on.isoformat(), "due_on": a.due_on.isoformat() if a.due_on else None,
                      "due": due_label(a, today), "days": (a.due_on - today).days if a.due_on else None, "online": a.online, "max_score": a.max_score, "state": state,
                      "mine": {"text": x.text, "link": x.link, "at": x.handed_in_at.isoformat() if x.handed_in_at else None, "score": x.score, "feedback": x.feedback} if x else None})
    order = {"late": 0, "todo": 1, "handed_in": 2, "marked": 3, "missing": 4, "excused": 5}
    items.sort(key=lambda i: (order[i["state"]], i["days"] if i["days"] is not None and i["state"] in ("todo", "late") else 0))
    return {"items": items, "can_act": can_act,
            "counts": {"todo": sum(1 for i in items if i["state"] == "todo"), "late": sum(1 for i in items if i["state"] == "late"),
                       "marked": sum(1 for i in items if i["state"] == "marked")}}


@router.get("/me/children/{student_id}/homework")
def family_homework(student_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    s, how = child_for(db, user, student_id)
    return homework_for(db, s, how == "self" and not rights.acting(user))


class HandInIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    text: str | None = Field(default=None, max_length=8000)
    link: str | None = Field(default=None, max_length=500)


@router.post("/me/children/{student_id}/homework/{aid}")
def hand_in(student_id: uuid.UUID, aid: uuid.UUID, data: HandInIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    s, how = child_for(db, user, student_id)
    if how != "self" or rights.acting(user):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the student can hand in their work")
    a = db.get(Assignment, aid)
    if not a or not any(i["id"] == str(aid) for i in homework_for(db, s, True)["items"]):
        raise not_found("Homework")
    if not a.online:
        raise HTTPException(status.HTTP_409_CONFLICT, "Hand this one in on paper in class")
    if not (data.text or data.link):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Write your answer or add a link")
    x = db.scalar(select(Submission).where(Submission.assignment_id == a.id, Submission.student_id == s.id))
    if x and x.status == "marked":
        raise HTTPException(status.HTTP_409_CONFLICT, "Your teacher has already marked this")
    if not x:
        x = Submission(assignment_id=a.id, student_id=s.id)
        db.add(x)
    x.text, x.link, x.handed_in_at, x.status = data.text, data.link, datetime.now(timezone.utc), "handed_in"
    db.commit()
    return homework_for(db, s, True)


# ---------- Results: broadsheet and report cards ----------

def class_subjects(db: Session, c: SchoolClass, studs: list[Student]) -> list[tuple[Subject, list[str]]]:
    """Every subject someone in the class takes, with the score sheets that cover it."""
    subs: dict = {}
    ids = [s.id for s in studs]
    chosen = set(db.scalars(select(StudentElective.subject_id).where(StudentElective.student_id.in_(ids or [uuid.uuid4()]))))
    for cs, sub in db.execute(select(ClassSubject, Subject).join(Subject, Subject.id == ClassSubject.subject_id).where(ClassSubject.class_id == c.id)):
        if cs.compulsory or sub.id in chosen:          # an elective nobody in the class takes is left out
            subs.setdefault(sub.id, (sub, set()))[1].add(f"class:{c.id}:{sub.id}")
    for el, sub in db.execute(select(StudentElective, Subject).join(Subject, Subject.id == StudentElective.subject_id).where(StudentElective.student_id.in_(ids or [uuid.uuid4()]))):
        subs.setdefault(sub.id, (sub, set()))[1].add(f"group:{el.group_id}" if el.group_id else f"class:{c.id}:{sub.id}")
    return sorted(((sub, sorted(keys)) for sub, keys in subs.values()), key=lambda x: x[0].name)


def compute_class(db: Session, c: SchoolClass, term: Term) -> dict:
    """Every number on the broadsheet and on each report card for one class and term."""
    school = school_of_class(db, c)
    scheme = scheme_for(db, school.id, c.level)
    bands = bands_for(db, school.id, c.level)
    studs = list(db.scalars(select(Student).where(Student.class_id == c.id, Student.status == StudentStatus.active).order_by(Student.last_name, Student.first_name)))
    ids = [s.id for s in studs]
    subjects = class_subjects(db, c, studs)
    takes: dict = defaultdict(set)
    elect = defaultdict(set)
    for el in db.scalars(select(StudentElective).where(StudentElective.student_id.in_(ids or [uuid.uuid4()]))):
        elect[el.student_id].add(el.subject_id)
    comp = {cs.subject_id: cs.compulsory for cs in db.scalars(select(ClassSubject).where(ClassSubject.class_id == c.id))}
    for s in studs:
        for sub, _ in subjects:
            if comp.get(sub.id) or sub.id in elect[s.id]:
                takes[s.id].add(sub.id)
    marks: dict = defaultdict(lambda: defaultdict(dict))
    for r in db.scalars(select(Score).where(Score.term_id == term.id, Score.student_id.in_(ids or [uuid.uuid4()]))):
        marks[r.student_id][r.subject_id][r.component] = r.value
    per: dict = defaultdict(dict)                    # per[student][subject] = {total, comps, grade, remark}
    for s in studs:
        for sub, _ in subjects:
            if sub.id not in takes[s.id]:
                continue
            total, comps = totals_for(scheme, marks[s.id][sub.id])
            g, rm = grade_of(total, bands)
            per[s.id][sub.id] = {"total": total, "components": comps, "grade": g, "remark": rm}
    sub_stats, sub_pos = {}, {}
    for sub, keys in subjects:
        vals = {s.id: per[s.id][sub.id]["total"] for s in studs if sub.id in per[s.id]}
        got = [v for v in vals.values() if v is not None]
        sub_stats[sub.id] = {"average": round(sum(got) / len(got), 1) if got else None, "highest": max(got) if got else None, "lowest": min(got) if got else None,
                             "scored": len(got), "takers": len(vals)}
        sub_pos[sub.id] = rank(vals)
    summary = {}
    for s in studs:
        got = [x["total"] for x in per[s.id].values() if x["total"] is not None]
        summary[s.id] = {"total": round(sum(got), 1) if got else None, "average": round(sum(got) / len(got), 1) if got else None, "subjects": len(got), "taking": len(per[s.id])}
    pos = rank({s.id: summary[s.id]["average"] for s in studs})
    avgs = [x["average"] for x in summary.values() if x["average"] is not None]
    statuses = {st.scope: st.status for st in db.scalars(select(SheetStatus).where(SheetStatus.term_id == term.id))}
    return {"school": school, "scheme": scheme, "bands": bands, "students": studs, "subjects": subjects, "per": per, "sub_stats": sub_stats, "sub_pos": sub_pos,
            "summary": summary, "position": pos, "statuses": statuses,
            "class_stats": {"average": round(sum(avgs) / len(avgs), 1) if avgs else None, "highest": max(avgs) if avgs else None, "lowest": min(avgs) if avgs else None, "size": len(studs)}}


def class_access(db: Session, user: User, c: SchoolClass) -> tuple[School, bool, bool]:
    """(school, may see, may manage) for a class's results."""
    school = school_of_class(db, c)
    manage = rights.has(user, school, "results.change", db) and not rights.acting(user)
    see = manage or rights.has(user, school, "results.see", db) or c.form_teacher_id == user.id
    if not see:
        raise not_found("Class")
    return school, see, manage


@router.get("/classes/{class_id}/results")
def broadsheet(class_id: uuid.UUID, term_id: uuid.UUID | None = None, user: User = Depends(current_user), db: Session = Depends(get_db)):
    c = db.get(SchoolClass, class_id)
    if not c:
        raise not_found("Class")
    school, _, manage = class_access(db, user, c)
    term = need_term(db, school.id, term_id)
    d = compute_class(db, c, term)
    cards = {rc.student_id: rc for rc in db.scalars(select(ReportCard).where(ReportCard.term_id == term.id, ReportCard.student_id.in_([s.id for s in d["students"]] or [uuid.uuid4()])))}
    subjects = []
    for sub, keys in d["subjects"]:
        sts = [d["statuses"].get(k, "open") for k in keys]
        teachers = sorted({n for n in (name_of(db, Scope(db, k).teacher_id) for k in keys) if n})
        st = d["sub_stats"][sub.id]
        subjects.append({"id": str(sub.id), "name": sub.name, "short": (sub.code or sub.name[:4]).upper(), "scopes": keys, "teacher": ", ".join(teachers) or None,
                         "status": "submitted" if all(x == "submitted" for x in sts) else "open", **st,
                         "complete": st["takers"] > 0 and st["scored"] == st["takers"]})
    rows = []
    for s in d["students"]:
        rc = cards.get(s.id)
        rows.append({"id": str(s.id), "name": f"{s.last_name}, {s.first_name}", "first_name": s.first_name, "thumb": s.photo_thumb, "gender": s.gender.value if s.gender else None,
                     "scores": {str(k): {"total": v["total"], "grade": v["grade"]} for k, v in d["per"][s.id].items()},
                     **d["summary"][s.id], "position": d["position"].get(s.id),
                     "card": {"status": rc.status, "comment": bool(rc.teacher_comment), "principal": bool(rc.principal_comment), "traits": len(rc.traits or {}),
                              "seen": bool(rc.seen_at)} if rc else None})
    ready = sum(1 for x in subjects if x["status"] == "submitted")
    return {"class": {"id": str(c.id), "name": c.name, "level": c.level, "form_teacher": name_of(db, c.form_teacher_id)}, "school": {"id": str(school.id), "name": school.name},
            "term": term_out(term), "subjects": subjects, "students": rows, "stats": d["class_stats"], "sheets_in": ready, "can_manage": manage,
            "is_form_teacher": c.form_teacher_id == user.id, "published": sum(1 for r in rows if r["card"] and r["card"]["status"] == "published"),
            "traits": TRAITS, "bands": [{"grade": g, "min": lo, "max": hi, "remark": rm} for g, lo, hi, rm in d["bands"]]}


def attendance_term(db: Session, s: Student, term: Term) -> dict:
    if not term.starts_on:
        return {"present": None, "days": None}
    end = min(term.ends_on or now_wat().date(), now_wat().date())
    rows = list(db.execute(select(AttendanceRecord.status, func.count()).where(AttendanceRecord.student_id == s.id, AttendanceRecord.kind == AttendanceKind.school,
                                                                              AttendanceRecord.on_date >= term.starts_on, AttendanceRecord.on_date <= end).group_by(AttendanceRecord.status)))
    days = sum(n for _, n in rows)
    present = sum(n for st, n in rows if st in (AttendanceStatus.present, AttendanceStatus.late))
    return {"present": present, "days": days, "absent": sum(n for st, n in rows if st == AttendanceStatus.absent)}


def earlier_terms(db: Session, s: Student, term: Term) -> list[dict]:
    """This session's earlier terms, from their published cards (for the cumulative column on the third-term card)."""
    out = []
    for t in term.session.terms:
        if t.number >= term.number:
            continue
        rc = db.scalar(select(ReportCard).where(ReportCard.term_id == t.id, ReportCard.student_id == s.id, ReportCard.status == "published"))
        if rc and rc.snapshot:
            out.append({"term": t.name, "number": t.number, "average": rc.snapshot["summary"]["average"],
                        "subjects": {x["subject"]: x["total"] for x in rc.snapshot["subjects"]}})
    return out


def card_data(db: Session, s: Student, term: Term, d: dict, rc: ReportCard | None) -> dict:
    """Everything printed on one report card."""
    school, c = d["school"], db.get(SchoolClass, s.class_id)
    house = db.get(House, s.house_id) if s.house_id else None
    early = earlier_terms(db, s, term)
    subjects = []
    for sub, keys in d["subjects"]:
        x = d["per"][s.id].get(sub.id)
        if not x:
            continue
        st = d["sub_stats"][sub.id]
        prev = [e["subjects"].get(sub.name) for e in early]
        allt = [v for v in prev + [x["total"]] if v is not None]
        subjects.append({"subject": sub.name, "components": x["components"], "total": x["total"], "grade": x["grade"], "remark": x["remark"],
                         "position": d["sub_pos"][sub.id].get(s.id), "class_average": st["average"], "highest": st["highest"], "lowest": st["lowest"],
                         "teacher": ", ".join(sorted({n for n in (name_of(db, Scope(db, k).teacher_id) for k in keys) if n})) or None,
                         "earlier": prev, "cumulative": round(sum(allt) / len(allt), 1) if early and allt else None})
    sm = d["summary"][s.id]
    g, rm = grade_of(sm["average"], d["bands"])
    pts = db.scalar(select(func.sum(ConductEntry.points)).where(ConductEntry.student_id == s.id,
                                                                ConductEntry.created_at >= datetime.combine(term.starts_on or now_wat().date(), datetime.min.time(), tzinfo=timezone.utc))) or 0
    prev_avgs = [e["average"] for e in early if e["average"] is not None]
    return {
        "school": {"name": school.name, "motto": school.motto, "logo": school.logo, "address": school.address, "phone": school.phone, "email": school.email, "colour": school.colour},
        "student": {"id": str(s.id), "name": s.full_name, "first_name": s.first_name, "admission_no": s.admission_no, "gender": s.gender.value if s.gender else None,
                    "photo": s.photo_thumb, "date_of_birth": s.date_of_birth.isoformat() if getattr(s, "date_of_birth", None) else None,
                    "house": house.name if house else None},
        "class": {"name": c.name if c else None, "level": c.level if c else None, "form_teacher": name_of(db, c.form_teacher_id) if c else None, "size": d["class_stats"]["size"]},
        "term": {"id": str(term.id), "name": term.name, "number": term.number, "session": term.session.name, "ends_on": term.ends_on.isoformat() if term.ends_on else None,
                 "next_starts_on": next_term_start(db, term)},
        "scheme": [{"name": x["name"], "max": x["max"]} for x in d["scheme"]],
        "subjects": subjects,
        "summary": {**sm, "position": d["position"].get(s.id), "out_of": d["class_stats"]["size"], "class_average": d["class_stats"]["average"], "grade": g, "remark": rm,
                    "best": max(subjects, key=lambda x: x["total"] or 0)["subject"] if subjects else None, "merit_points": int(pts),
                    "earlier": [{"term": e["term"], "average": e["average"]} for e in early],
                    "cumulative": round(sum(prev_avgs + [sm["average"]]) / (len(prev_avgs) + 1), 1) if early and sm["average"] is not None else None},
        "attendance": attendance_term(db, s, term),
        "traits": rc.traits if rc else {}, "trait_groups": TRAITS, "trait_words": TRAIT_WORDS,
        "teacher_comment": rc.teacher_comment if rc else None, "principal_comment": rc.principal_comment if rc else None,
        "bands": [{"grade": g2, "min": lo, "max": hi, "remark": r2} for g2, lo, hi, r2 in d["bands"]],
    }


def stu_class(db: Session, user: User, student_id: uuid.UUID) -> tuple[Student, SchoolClass, School, bool]:
    s = db.get(Student, student_id)
    c = db.get(SchoolClass, s.class_id) if s and s.class_id else None
    if not s or not c:
        raise not_found("Student")
    school, _, manage = class_access(db, user, c)
    return s, c, school, manage


@router.get("/report-cards/{student_id}")
def staff_card(student_id: uuid.UUID, term_id: uuid.UUID | None = None, user: User = Depends(current_user), db: Session = Depends(get_db)):
    s, c, school, manage = stu_class(db, user, student_id)
    term = need_term(db, school.id, term_id)
    rc = db.scalar(select(ReportCard).where(ReportCard.term_id == term.id, ReportCard.student_id == s.id))
    data = rc.snapshot if rc and rc.status == "published" and rc.snapshot else card_data(db, s, term, compute_class(db, c, term), rc)
    return {"card": data, "class_id": str(c.id), "status": rc.status if rc else "draft", "code": rc.code if rc and rc.status == "published" else None,
            "published_at": rc.published_at.isoformat() if rc and rc.published_at else None, "can_manage": manage,
            "can_comment": (c.form_teacher_id == user.id and not rights.acting(user)) or manage, "seen": bool(rc and rc.seen_at)}


class CardIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    term_id: uuid.UUID
    traits: dict[str, int] | None = None
    teacher_comment: str | None = Field(default=None, max_length=600)
    principal_comment: str | None = Field(default=None, max_length=600)


@router.put("/report-cards/{student_id}")
def save_card(student_id: uuid.UUID, data: CardIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    s, c, school, manage = stu_class(db, user, student_id)
    ft = c.form_teacher_id == user.id and not rights.acting(user)
    if not (ft or manage):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the form teacher or the principal can write on report cards")
    term = need_term(db, school.id, data.term_id)
    rc = db.scalar(select(ReportCard).where(ReportCard.term_id == term.id, ReportCard.student_id == s.id))
    if rc and rc.status == "published":
        raise HTTPException(status.HTTP_409_CONFLICT, "This report card is published. Take it back first to change it.")
    if not rc:
        rc = ReportCard(term_id=term.id, student_id=s.id, class_id=c.id, traits={})
        db.add(rc)
    fs = data.model_fields_set
    if data.traits is not None:
        names = {t for g in TRAITS.values() for t in g}
        rc.traits = {k: max(1, min(5, int(v))) for k, v in data.traits.items() if k in names}
    if "teacher_comment" in fs:
        rc.teacher_comment = data.teacher_comment or None
    if "principal_comment" in fs:
        if not manage:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the principal can write the principal's comment")
        rc.principal_comment = data.principal_comment or None
    db.commit()
    return staff_card(student_id, term.id, user, db)


def suggest_comment(card: dict, who: str, seed: int) -> str:
    """A short, warm, specific comment from the numbers (the teacher can change it before saving)."""
    rnd = random.Random(seed)
    n, sm = card["student"]["first_name"], card["summary"]
    avg, subjects = sm["average"], card["subjects"]
    if avg is None:
        return f"{n} has no scores yet this term."
    good = sorted([x for x in subjects if x["total"] is not None], key=lambda x: -x["total"])
    best = [x["subject"] for x in good[:2]]
    weak = [x["subject"] for x in good if x["total"] < 50][-2:]
    earlier = [e["average"] for e in sm["earlier"] if e["average"] is not None]
    trend = (avg - earlier[-1]) if earlier else None
    att = card["attendance"]
    att_pc = round(100 * att["present"] / att["days"]) if att.get("days") else None
    if avg >= 75:
        open_ = rnd.choice([f"An excellent term, {n}!", f"Outstanding work this term, {n}.", f"{n} has had a superb term."])
    elif avg >= 60:
        open_ = rnd.choice([f"A very good term, {n}.", f"{n} has worked well this term.", f"Good, steady progress this term, {n}."])
    elif avg >= 50:
        open_ = rnd.choice([f"A fair term, {n}.", f"{n} is doing well in places and can do better.", f"{n} has made a reasonable effort this term."])
    else:
        open_ = rnd.choice([f"{n} needs to work much harder.", f"This has been a difficult term for {n}.", f"{n} can do far better than this."])
    bits = [open_]
    if best:
        bits.append(rnd.choice([f"Strongest in {' and '.join(best)}.", f"Very good results in {' and '.join(best)}.", f"{' and '.join(best)} {'are' if len(best) > 1 else 'is'} a real strength."]))
    if weak:
        bits.append(rnd.choice([f"More effort is needed in {' and '.join(weak)}.", f"Extra practice in {' and '.join(weak)} will help.", f"Let's focus on {' and '.join(weak)} next term."]))
    if trend is not None and abs(trend) >= 3:
        bits.append(f"Up {trend:.0f} marks on last term. Well done." if trend > 0 else f"Down {abs(trend):.0f} marks on last term, so let's work on this together.")
    if att_pc is not None and att_pc < 85:
        bits.append("Better attendance will help a lot.")
    if who == "principal":
        bits = [bits[0], rnd.choice(["Keep it up.", "Keep aiming high.", "We are proud of you.", "We expect even more next term."] if avg >= 60
                                    else ["We believe you can improve.", "Work closely with your teachers.", "Come back ready to work hard."])]
    else:
        bits.append(rnd.choice(["Keep it up!", "Keep working hard.", "I look forward to next term."]) if avg >= 50 else "I know you can do it.")
    return " ".join(bits)[:600]


class SuggestIn(BaseModel):
    term_id: uuid.UUID
    who: str = Field(pattern="^(teacher|principal)$")
    seed: int = 0


@router.post("/report-cards/{student_id}/suggest")
def suggest(student_id: uuid.UUID, data: SuggestIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    s, c, school, manage = stu_class(db, user, student_id)
    term = need_term(db, school.id, data.term_id)
    rc = db.scalar(select(ReportCard).where(ReportCard.term_id == term.id, ReportCard.student_id == s.id))
    return {"text": suggest_comment(card_data(db, s, term, compute_class(db, c, term), rc), data.who, data.seed)}


class PublishIn(BaseModel):
    term_id: uuid.UUID
    student_ids: list[uuid.UUID] | None = None


@router.post("/classes/{class_id}/results/publish")
def publish(class_id: uuid.UUID, data: PublishIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    c = db.get(SchoolClass, class_id)
    if not c:
        raise not_found("Class")
    school, _, manage = class_access(db, user, c)
    if not manage:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only someone who can change results can publish report cards")
    term = need_term(db, school.id, data.term_id)
    d = compute_class(db, c, term)
    want = set(data.student_ids or [s.id for s in d["students"]])
    cards = {rc.student_id: rc for rc in db.scalars(select(ReportCard).where(ReportCard.term_id == term.id, ReportCard.student_id.in_(list(want) or [uuid.uuid4()])))}
    n = 0
    for s in d["students"]:
        if s.id not in want or d["summary"][s.id]["average"] is None:
            continue
        rc = cards.get(s.id)
        if rc and rc.status == "published":
            continue
        if not rc:
            rc = ReportCard(term_id=term.id, student_id=s.id, class_id=c.id, traits={})
            db.add(rc)
        rc.snapshot = card_data(db, s, term, d, rc)
        rc.status, rc.published_at, rc.published_by_id, rc.seen_at = "published", datetime.now(timezone.utc), user.id, None
        rc.code = rc.code or secrets.token_hex(4).upper()
        rc.snapshot["code"] = rc.code
        sm = d["summary"][s.id]
        notify(db, family_of(s), school.id, f"{s.first_name}'s {term.name} report card is ready: average {sm['average']}%" + (f", {d['position'][s.id]} in {c.name}" if d['position'].get(s.id) else "") + ".",
               f"#/child/{s.id}", "award")
        n += 1
    db.commit()
    return {"published": n}


@router.post("/classes/{class_id}/results/unpublish")
def unpublish(class_id: uuid.UUID, data: PublishIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    c = db.get(SchoolClass, class_id)
    if not c:
        raise not_found("Class")
    school, _, manage = class_access(db, user, c)
    if not manage:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only someone who can change results can do this")
    term = need_term(db, school.id, data.term_id)
    q = select(ReportCard).where(ReportCard.term_id == term.id, ReportCard.class_id == c.id, ReportCard.status == "published")
    if data.student_ids:
        q = q.where(ReportCard.student_id.in_(data.student_ids))
    n = 0
    for rc in db.scalars(q):
        rc.status = "draft"
        n += 1
    db.commit()
    return {"taken_back": n}


# ---------- Report cards for students and parents ----------

def published_cards(db: Session, s: Student) -> list[dict]:
    out = []
    for rc, t in db.execute(select(ReportCard, Term).join(Term, Term.id == ReportCard.term_id).where(ReportCard.student_id == s.id, ReportCard.status == "published")
                            .order_by(ReportCard.published_at.desc())):
        sm = rc.snapshot["summary"]
        out.append({"id": str(rc.id), "term_id": str(t.id), "term": t.name, "session": t.session.name, "class_name": rc.snapshot["class"]["name"],
                    "average": sm["average"], "position": sm["position"], "out_of": sm["out_of"], "grade": sm["grade"], "subjects": len(rc.snapshot["subjects"]),
                    "best": sm.get("best"), "published_at": rc.published_at.isoformat(), "seen": bool(rc.seen_at)})
    return out


@router.get("/me/children/{student_id}/results")
def family_results(student_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    s, _ = child_for(db, user, student_id)
    return {"cards": published_cards(db, s)}


@router.get("/me/children/{student_id}/report-cards/{card_id}")
def family_card(student_id: uuid.UUID, card_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    s, _ = child_for(db, user, student_id)
    rc = db.get(ReportCard, card_id)
    if not rc or rc.student_id != s.id or rc.status != "published":
        raise not_found("Report card")
    if not rc.seen_at and not rights.acting(user):
        rc.seen_at = datetime.now(timezone.utc)
        db.commit()
    return {"card": rc.snapshot, "code": rc.code, "published_at": rc.published_at.isoformat()}


@router.get("/verify/report/{code}")
def verify(code: str, db: Session = Depends(get_db)):
    """Anyone can check that a printed report card is genuine (the QR code on the card opens this)."""
    rc = db.scalar(select(ReportCard).where(ReportCard.code == code.upper()[:12], ReportCard.status == "published"))
    if not rc:
        raise not_found("Report card")
    sn = rc.snapshot
    return {"school": sn["school"]["name"], "student": sn["student"]["name"], "admission_no": sn["student"]["admission_no"], "class_name": sn["class"]["name"],
            "term": sn["term"]["name"], "session": sn["term"]["session"], "average": sn["summary"]["average"], "position": sn["summary"]["position"],
            "out_of": sn["summary"]["out_of"], "subjects": [{"subject": x["subject"], "total": x["total"], "grade": x["grade"]} for x in sn["subjects"]],
            "published_at": rc.published_at.isoformat()}


@router.get("/schools/{school_id}/results")
def results_overview(school_id: uuid.UUID, term_id: uuid.UUID | None = None, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Every class this term: how many score sheets are in and how many report cards are out."""
    school = db.get(School, school_id)
    if not school or not rights.has(user, school, "results.see", db):
        raise not_found("School")
    term = need_term(db, school.id, term_id)
    from app.api.academics import _level_order
    statuses = {st.scope: st.status for st in db.scalars(select(SheetStatus).where(SheetStatus.term_id == term.id))}
    out = []
    classes = sorted(db.scalars(select(SchoolClass).join(Branch, Branch.id == SchoolClass.branch_id).where(Branch.school_id == school_id)), key=lambda c: (_level_order(c.level), c.name))
    for c in classes:
        n = db.scalar(select(func.count()).select_from(Student).where(Student.class_id == c.id, Student.status == StudentStatus.active)) or 0
        if not n:
            continue
        subs = class_subjects(db, c, list(db.scalars(select(Student).where(Student.class_id == c.id, Student.status == StudentStatus.active))))
        done = sum(1 for _, keys in subs if keys and all(statuses.get(k) == "submitted" for k in keys))
        late = [s.name for s, keys in subs if not all(statuses.get(k) == "submitted" for k in keys)]
        pub = db.scalar(select(func.count()).select_from(ReportCard).where(ReportCard.term_id == term.id, ReportCard.class_id == c.id, ReportCard.status == "published")) or 0
        seen = db.scalar(select(func.count()).select_from(ReportCard).where(ReportCard.term_id == term.id, ReportCard.class_id == c.id, ReportCard.seen_at.is_not(None))) or 0
        out.append({"id": str(c.id), "name": c.name, "level": c.level, "form_teacher": name_of(db, c.form_teacher_id), "students": n, "subjects": len(subs), "sheets_in": done,
                    "waiting_for": late[:6], "published": pub, "seen": seen})
    return {"term": term_out(term), "classes": out, "can_manage": rights.has(user, school, "results.change", db)}
