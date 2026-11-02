"""The timetable: built automatically (no teacher or class in two places at once), changed by hand, and cover for absent teachers.

Electives: the groups of one level that share no student and no teacher are taught at the same time, in an
'options block'. While a block runs, the level's classes split into their groups.
"""
import random
import time as _time
import uuid
from collections import Counter, defaultdict
from datetime import date, datetime, time, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import delete, select, true
from sqlalchemy.orm import Session

from app.api.access import check, not_found
from app.api.academics import _level_order
from app.api.deps import current_user
from app.api.staff_day import now_wat
from app.core import rights
from app.core.db import get_db
from app.models import (
    Branch, ClassSubject, CoverLesson, Membership, Notice, Period, Role, School, SchoolClass, Section, Student, StudentElective, Subject,
    TeachingGroup, TimetableGroupSlot, TimetableSettings, TimetableSlot, User,
)
from app.models.people import StudentStatus
from app.models.staffday import LeaveRequest, StaffAttendance
from app.models.structure import PeriodKind

router = APIRouter(prefix="/api", tags=["timetable"])

DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
# The usual number of lessons a week, and which subjects like a double lesson.
USUAL = [("further math", 4), ("english", 5), ("math", 5), ("physics", 4), ("chemistry", 4), ("biology", 4), ("basic science", 3), ("basic tech", 3),
         ("agric", 3), ("economics", 4), ("government", 3), ("literature", 3), ("geography", 3), ("account", 3), ("commerce", 3), ("technical drawing", 3),
         ("business", 3), ("civic", 2), ("religious", 2), ("crs", 2), ("irs", 2), ("computer", 2), ("physical", 2), ("creative", 2), ("french", 2),
         ("igbo", 2), ("yoruba", 2), ("hausa", 2), ("home econ", 2), ("social", 2), ("music", 1), ("security", 1)]
DOUBLES = ("physics", "chemistry", "biology", "technical drawing", "home econ", "food")
CORE = ("english", "math")
STANDARD_DAY = [("Assembly", "assembly", "07:45", "08:00"), ("Lesson 1", "lesson", "08:00", "08:40"), ("Lesson 2", "lesson", "08:40", "09:20"),
                ("Lesson 3", "lesson", "09:20", "10:00"), ("Short break", "break", "10:00", "10:20"), ("Lesson 4", "lesson", "10:20", "11:00"),
                ("Lesson 5", "lesson", "11:00", "11:40"), ("Lesson 6", "lesson", "11:40", "12:20"), ("Long break", "break", "12:20", "13:00"),
                ("Lesson 7", "lesson", "13:00", "13:40"), ("Lesson 8", "lesson", "13:40", "14:20")]


def usual(name: str) -> int:
    n = name.lower()
    return next((v for k, v in USUAL if k in n), 3)


def likes_double(name: str) -> bool:
    return any(k in name.lower() for k in DOUBLES)


def mins(t: time) -> int:
    return t.hour * 60 + t.minute


def settings_for(db: Session, school_id: uuid.UUID) -> TimetableSettings:
    st = db.scalar(select(TimetableSettings).where(TimetableSettings.school_id == school_id))
    if not st:
        st = TimetableSettings(school_id=school_id, days=[0, 1, 2, 3, 4], max_same_day=2, report={})
        db.add(st)
        db.flush()
    return st


def need_school(db: Session, user: User, school_id: uuid.UUID) -> School:
    s = db.get(School, school_id)
    if not s:
        raise not_found("School")
    check(user, s, "teaching")
    return s


# ---------- What the school looks like, for building ----------

class World:
    """Everything the builder and the views need, loaded once."""

    def __init__(self, db: Session, school_id: uuid.UUID):
        self.db = db
        self.school_id = school_id
        self.st = settings_for(db, school_id)
        self.classes = list(db.scalars(select(SchoolClass).join(Branch, Branch.id == SchoolClass.branch_id).where(Branch.school_id == school_id)
                                       .order_by(SchoolClass.level_order, SchoolClass.arm)))
        self.class_by_id = {c.id: c for c in self.classes}
        self.all_periods = list(db.scalars(select(Period).where(Period.school_id == school_id).order_by(Period.starts_at)))
        self.period_by_id = {p.id: p for p in self.all_periods}
        sections = list(db.scalars(select(Section).where(Section.school_id == school_id)))
        own = {p.section_id for p in self.all_periods if p.section_id}
        self.section_of_level = {lv: s.id for s in sections if s.id in own for lv in (s.levels or [])}
        self.subjects = {s.id: s for s in db.scalars(select(Subject).where(Subject.school_id == school_id))}
        ids = [c.id for c in self.classes] or [uuid.uuid4()]
        self.class_subjects = list(db.scalars(select(ClassSubject).where(ClassSubject.class_id.in_(ids))))
        bids = list({c.branch_id for c in self.classes}) or [uuid.uuid4()]
        self.groups = list(db.scalars(select(TeachingGroup).where(TeachingGroup.branch_id.in_(bids))))
        self.group_by_id = {g.id: g for g in self.groups}
        names = dict(db.execute(select(User.id, User.full_name).where(User.id.in_(
            {x.teacher_user_id for x in self.class_subjects if x.teacher_user_id} | {g.teacher_user_id for g in self.groups if g.teacher_user_id} | {c.form_teacher_id for c in self.classes if c.form_teacher_id} or {uuid.uuid4()}))).all())
        self.names = names

    def periods_for(self, c: SchoolClass) -> list[Period]:
        sec = self.section_of_level.get(c.level)
        return [p for p in self.all_periods if p.section_id == sec]

    def lesson_periods(self, c: SchoolClass) -> list[Period]:
        return [p for p in self.periods_for(c) if p.kind == PeriodKind.lesson]

    def pairs(self, c: SchoolClass) -> set[tuple[uuid.UUID, uuid.UUID]]:
        """Lesson periods that follow each other with no break between: room for a double lesson."""
        ps = self.periods_for(c)
        return {(a.id, b.id) for a, b in zip(ps, ps[1:]) if a.kind == PeriodKind.lesson and b.kind == PeriodKind.lesson}

    def grouped(self) -> dict[tuple[uuid.UUID, str], list[TeachingGroup]]:
        out = defaultdict(list)
        for g in self.groups:
            out[(g.branch_id, g.level)].append(g)
        return out

    def needs(self) -> dict[uuid.UUID, list[dict]]:
        """Per class: the subjects taught to the whole class and how many lessons each, fitted to the week."""
        week = len(self.st.days or [])
        grouped = {(b, lv): {g.subject_id for g in gs} for (b, lv), gs in self.grouped().items()}
        blocks = self.blocks()
        out = {}
        for c in self.classes:
            rows = []
            elective_subjects = grouped.get((c.branch_id, c.level), set())
            for cs in self.class_subjects:
                if cs.class_id != c.id or cs.subject_id in elective_subjects:
                    continue
                sub = self.subjects.get(cs.subject_id)
                if not sub:
                    continue
                rows.append({"id": str(cs.id), "subject_id": str(sub.id), "subject": sub.name, "teacher_id": str(cs.teacher_user_id) if cs.teacher_user_id else None,
                             "teacher": self.names.get(cs.teacher_user_id), "set": cs.periods, "periods": cs.periods if cs.periods is not None else usual(sub.name),
                             "double": cs.double, "auto": cs.periods is None, "core": any(k in sub.name.lower() for k in CORE)})
            room = len(self.lesson_periods(c)) * week - sum(b["periods"] for b in blocks.get((c.branch_id, c.level), []))
            # Trim the usual numbers (never the ones the school set) until the week fits.
            total = sum(r["periods"] for r in rows)
            order = sorted([r for r in rows if r["auto"] and not r["core"]], key=lambda r: (-r["periods"], r["subject"]))
            while total > room and order:
                trimmed = False
                for r in order:
                    if total <= room:
                        break
                    if r["periods"] > 1:
                        r["periods"] -= 1
                        total -= 1
                        trimmed = True
                if not trimmed:
                    break
            out[c.id] = rows
        return out

    def blocks(self) -> dict[tuple[uuid.UUID, str], list[dict]]:
        """Options blocks per level: groups that share no student and no teacher run together."""
        out = {}
        gids = [g.id for g in self.groups] or [uuid.uuid4()]
        members = defaultdict(set)
        for sid, gid in self.db.execute(select(StudentElective.student_id, StudentElective.group_id).join(Student, Student.id == StudentElective.student_id)
                                        .where(StudentElective.group_id.in_(gids), Student.status == StudentStatus.active)):
            members[gid].add(sid)
        for key, gs in self.grouped().items():
            gs = sorted(gs, key=lambda g: (-len(members[g.id]), self.subjects[g.subject_id].name if g.subject_id in self.subjects else ""))
            colour: dict[uuid.UUID, int] = {}
            for g in gs:
                used = {colour[h.id] for h in gs if h.id in colour and (members[g.id] & members[h.id] or (g.teacher_user_id and g.teacher_user_id == h.teacher_user_id))}
                colour[g.id] = next(i for i in range(len(gs) + 1) if i not in used)
            n = max(colour.values(), default=-1) + 1
            blocks = []
            for i in range(n):
                these = [g for g in gs if colour[g.id] == i]
                per = max((g.periods if g.periods is not None else usual(self.subjects[g.subject_id].name if g.subject_id in self.subjects else "")) for g in these)
                blocks.append({"name": f"Options {i + 1}", "periods": per, "groups": [g.id for g in these],
                               "subjects": sorted({self.subjects[g.subject_id].name for g in these if g.subject_id in self.subjects})})
            out[key] = blocks
        return out


# ---------- Building ----------

class Unit:
    __slots__ = ("kind", "classes", "teachers", "subject", "length", "label", "ref", "groups")

    def __init__(self, kind, classes, teachers, subject, length, label, ref, groups=()):
        self.kind, self.classes, self.teachers, self.subject, self.length, self.label, self.ref, self.groups = kind, classes, teachers, subject, length, label, ref, groups


def build(db: Session, school_id: uuid.UUID, keep_locked: bool = True, tries: int = 30) -> dict:
    w = World(db, school_id)
    days = sorted(w.st.days or [0, 1, 2, 3, 4])
    max_day = max(1, w.st.max_same_day or 2)
    needs = w.needs()
    blocks = w.blocks()
    if not any(w.lesson_periods(c) for c in w.classes):
        raise HTTPException(status.HTTP_409_CONFLICT, "Add the bell times first: the lessons in a school day")
    locked = list(db.scalars(select(TimetableSlot).where(TimetableSlot.school_id == school_id, TimetableSlot.locked.is_(True)))) if keep_locked else []

    # The units to place.
    units: list[Unit] = []
    for c in w.classes:
        for r in needs.get(c.id, []):
            n = r["periods"]
            if n <= 0:
                continue
            sid = uuid.UUID(r["subject_id"])
            t = uuid.UUID(r["teacher_id"]) if r["teacher_id"] else None
            already = sum(1 for s in locked if s.class_id == c.id and s.subject_id == sid)
            n -= already
            doubles = 1 if r["double"] and n >= 2 else 0
            for _ in range(doubles):
                units.append(Unit("lesson", (c.id,), (t,) if t else (), sid, 2, r["subject"], c.id))
            for _ in range(n - 2 * doubles):
                units.append(Unit("lesson", (c.id,), (t,) if t else (), sid, 1, r["subject"], c.id))
    for (branch_id, level), bl in blocks.items():
        cls = tuple(c.id for c in w.classes if c.branch_id == branch_id and c.level == level)
        if not cls:
            continue
        for b in bl:
            teachers = tuple({w.group_by_id[g].teacher_user_id for g in b["groups"] if w.group_by_id[g].teacher_user_id})
            for _ in range(b["periods"]):
                units.append(Unit("block", cls, teachers, None, 1, f"{level} {b['name']}", (branch_id, level, b["name"]), tuple(b["groups"])))

    # Time of each period, so teachers working in two sections with different bells are still never double-booked.
    span = {p.id: (mins(p.starts_at), mins(p.ends_at)) for p in w.all_periods}
    lessons = {c.id: [p.id for p in w.lesson_periods(c)] for c in w.classes}
    pairs = {c.id: w.pairs(c) for c in w.classes}
    teacher_load = Counter(t for u in units for t in u.teachers for _ in range(u.length))

    def attempt(seed: int):
        rnd = random.Random(seed)
        class_busy: dict[tuple, bool] = {}
        teacher_busy: dict[tuple[uuid.UUID, int], list[tuple[int, int]]] = defaultdict(list)
        subj_day: Counter = Counter()
        t_day: Counter = Counter()
        placed: list[tuple[Unit, int, list[uuid.UUID]]] = []
        for s in locked:
            class_busy[(s.class_id, s.weekday, s.period_id)] = True
            if s.teacher_user_id and s.period_id in span:
                teacher_busy[(s.teacher_user_id, s.weekday)].append(span[s.period_id])
            if s.subject_id:
                subj_day[(s.class_id, s.subject_id, s.weekday)] += 1

        def t_free(t, d, pids):
            return all(not (a < e and s < b) for pid in pids for (s, e) in [span[pid]] for (a, b) in teacher_busy[(t, d)])

        order = sorted(units, key=lambda u: (-(u.kind == "block"), -u.length, -max((teacher_load[t] for t in u.teachers), default=0), rnd.random()))
        missing = []
        for u in order:
            best, best_score = None, None
            first = u.classes[0]
            for d in days:
                if u.subject and subj_day[(first, u.subject, d)] + u.length > max_day:
                    continue
                opts = lessons[first]
                for i, pid in enumerate(opts):
                    pids = [pid] if u.length == 1 else ([pid, opts[i + 1]] if i + 1 < len(opts) and (pid, opts[i + 1]) in pairs[first] else None)
                    if not pids:
                        continue
                    # A block needs the same period free in every class of the level.
                    if any(class_busy.get((c, d, p)) or p not in lessons[c] for c in u.classes for p in pids):
                        continue
                    if not all(t_free(t, d, pids) for t in u.teachers):
                        continue
                    score = rnd.random() * 0.8
                    if u.subject:
                        score += 3 * subj_day[(first, u.subject, d)]
                        sub = w.subjects.get(u.subject)
                        if sub and any(k in sub.name.lower() for k in CORE):
                            score += 0.25 * i          # English and maths in the morning
                    score += 0.4 * sum(t_day[(t, d)] for t in u.teachers)
                    if best_score is None or score < best_score:
                        best, best_score = (d, pids), score
            if not best:
                missing.append(u)
                continue
            d, pids = best
            for c in u.classes:
                for p in pids:
                    class_busy[(c, d, p)] = True
            for t in u.teachers:
                for p in pids:
                    teacher_busy[(t, d)].append(span[p])
                t_day[(t, d)] += len(pids)
            if u.subject:
                subj_day[(first, u.subject, d)] += len(pids)
            placed.append((u, d, pids))
        return placed, missing

    started = _time.time()
    best = None
    for k in range(tries):
        placed, missing = attempt(k)
        if best is None or len(missing) < len(best[1]):
            best = (placed, missing)
        if not missing or _time.time() - started > 8:
            break
    placed, missing = best

    # Save: clear what isn't locked and write the new week.
    db.execute(delete(TimetableSlot).where(TimetableSlot.school_id == school_id, TimetableSlot.locked.is_(False) if keep_locked else true()))
    db.execute(delete(TimetableGroupSlot).where(TimetableGroupSlot.school_id == school_id))
    for u, d, pids in placed:
        for p in pids:
            if u.kind == "lesson":
                db.add(TimetableSlot(school_id=school_id, class_id=u.classes[0], weekday=d, period_id=p, kind="lesson", subject_id=u.subject,
                                     teacher_user_id=u.teachers[0] if u.teachers else None))
            else:
                for c in u.classes:
                    db.add(TimetableSlot(school_id=school_id, class_id=c, weekday=d, period_id=p, kind="block", block=u.ref[2]))
                for g in u.groups:
                    db.add(TimetableGroupSlot(school_id=school_id, group_id=g, weekday=d, period_id=p, teacher_user_id=w.group_by_id[g].teacher_user_id, block=u.ref[2]))
    why = []
    for u in missing:
        who = ", ".join(w.names.get(t, "?") for t in u.teachers)
        cname = w.class_by_id[u.classes[0]].name if u.kind == "lesson" else u.label
        heavy = [w.names.get(t, "?") for t in u.teachers if teacher_load[t] > 0.85 * len(days) * max((len(v) for v in lessons.values()), default=0)]
        why.append({"what": f"{u.label} ({cname})" if u.kind == "lesson" else u.label, "length": u.length, "teacher": who or None,
                    "why": f"{', '.join(heavy)} teach{'es' if len(heavy) == 1 else ''} almost every period" if heavy else
                    "No free double period that day pattern allows" if u.length == 2 else "No period where the class and teacher are both free"})
    w.st.built_at = datetime.now(timezone.utc)
    w.st.report = {"placed": sum(len(p) * (len(u.classes) if u.kind == "lesson" else 1) for u, _, p in placed), "missing": why,
                   "units": len(units), "seconds": round(_time.time() - started, 1), "blocks": sum(len(b) for b in blocks.values())}
    db.commit()
    return w.st.report


# ---------- Endpoints: setting up ----------

@router.get("/schools/{school_id}/timetable/setup")
def setup(school_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    need_school(db, user, school_id)
    w = World(db, school_id)
    needs = w.needs()
    blocks = w.blocks()
    days = w.st.days or []
    out_classes, t_load = [], Counter()
    for c in w.classes:
        rows = needs.get(c.id, [])
        bl = blocks.get((c.branch_id, c.level), [])
        room = len(w.lesson_periods(c)) * len(days)
        need = sum(r["periods"] for r in rows) + sum(b["periods"] for b in bl)
        for r in rows:
            if r["teacher_id"]:
                t_load[r["teacher_id"]] += r["periods"]
        out_classes.append({"id": str(c.id), "name": c.name, "level": c.level, "subjects": rows, "blocks": [{**b, "groups": [str(g) for g in b["groups"]]} for b in bl],
                            "need": need, "room": room, "no_teacher": [r["subject"] for r in rows if not r["teacher_id"]]})
    for key, bl in blocks.items():
        for b in bl:
            for g in b["groups"]:
                t = w.group_by_id[g].teacher_user_id
                if t:
                    t_load[str(t)] += b["periods"]
    most = max((len(w.lesson_periods(c)) for c in w.classes), default=0) * len(days)
    teachers = sorted([{"id": t, "name": w.names.get(uuid.UUID(t), "?"), "periods": n, "free": most - n} for t, n in t_load.items()], key=lambda x: -x["periods"])
    bells = [{"id": str(p.id), "name": p.name, "kind": p.kind.value, "starts_at": p.starts_at.strftime("%H:%M"), "ends_at": p.ends_at.strftime("%H:%M"),
              "section": next((s.name for s in db.scalars(select(Section).where(Section.id == p.section_id))), None) if p.section_id else None} for p in w.all_periods]
    warnings = []
    if not any(b["kind"] == "lesson" for b in bells):
        warnings.append("No bell times yet. Use “Standard school day” or add them in Calendar.")
    for c in out_classes:
        if c["need"] > c["room"]:
            warnings.append(f"{c['name']} needs {c['need']} lessons but the week has {c['room']}. Lower some subjects.")
    for t in teachers:
        if t["free"] < 0:
            warnings.append(f"{t['name']} has {t['periods']} lessons but the week has only {most}. Share their classes.")
        elif t["free"] <= 1:
            warnings.append(f"{t['name']} teaches {t['periods']} of {most} periods. Some of their lessons may not fit; give one class to someone else.")
    nt = sum(len(c["no_teacher"]) for c in out_classes)
    if nt:
        warnings.append(f"{nt} class subject{'s have' if nt > 1 else ' has'} no teacher yet. They will be timetabled, with no teacher shown.")
    return {"days": days, "max_same_day": w.st.max_same_day, "bells": bells, "classes": out_classes, "teachers": teachers, "warnings": warnings,
            "week": most, "built_at": w.st.built_at.isoformat() if w.st.built_at else None, "published_at": w.st.published_at.isoformat() if w.st.published_at else None,
            "report": w.st.report or {}}


@router.post("/schools/{school_id}/timetable/standard-day")
def standard_day(school_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    school = need_school(db, user, school_id)
    if not rights.has(user, school, "teaching.change", db) or rights.acting(user):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You can look at the timetable but not change it")
    if db.scalar(select(Period.id).where(Period.school_id == school_id)):
        raise HTTPException(status.HTTP_409_CONFLICT, "The school already has bell times. Change them in Calendar.")
    for name, kind, a, b in STANDARD_DAY:
        db.add(Period(school_id=school_id, name=name, kind=PeriodKind(kind) if kind != "break" else PeriodKind.break_,
                      starts_at=time.fromisoformat(a), ends_at=time.fromisoformat(b)))
    db.commit()
    return {"added": len(STANDARD_DAY)}


class SettingsIn(BaseModel):
    days: list[int] = Field(min_length=1, max_length=7)
    max_same_day: int = Field(ge=1, le=4)


@router.put("/schools/{school_id}/timetable/settings")
def save_settings(school_id: uuid.UUID, data: SettingsIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    need_school(db, user, school_id)
    st = settings_for(db, school_id)
    st.days = sorted({d for d in data.days if 0 <= d <= 6})
    st.max_same_day = data.max_same_day
    db.commit()
    return {"days": st.days, "max_same_day": st.max_same_day}


class LoadIn(BaseModel):
    level: str
    subject_id: uuid.UUID
    periods: int | None = Field(default=None, ge=0, le=12)
    double: bool = False


@router.put("/schools/{school_id}/timetable/loads")
def save_load(school_id: uuid.UUID, data: LoadIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """How many lessons a week a subject gets, for every class of a level at once."""
    need_school(db, user, school_id)
    w = World(db, school_id)
    ids = {c.id for c in w.classes if c.level == data.level}
    n = 0
    for cs in w.class_subjects:
        if cs.class_id in ids and cs.subject_id == data.subject_id:
            cs.periods, cs.double = data.periods, data.double
            n += 1
    for g in w.groups:
        if g.level == data.level and g.subject_id == data.subject_id:
            g.periods = data.periods
            n += 1
    db.commit()
    return {"changed": n}


class BuildIn(BaseModel):
    keep_locked: bool = True


@router.post("/schools/{school_id}/timetable/build")
def build_now(school_id: uuid.UUID, data: BuildIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    need_school(db, user, school_id)
    return build(db, school_id, data.keep_locked)


@router.post("/schools/{school_id}/timetable/publish")
def publish(school_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    school = need_school(db, user, school_id)
    st = settings_for(db, school_id)
    st.published_at = datetime.now(timezone.utc)
    teachers = set(db.scalars(select(TimetableSlot.teacher_user_id).where(TimetableSlot.school_id == school_id, TimetableSlot.teacher_user_id.is_not(None)))) | \
        set(db.scalars(select(TimetableGroupSlot.teacher_user_id).where(TimetableGroupSlot.school_id == school_id, TimetableGroupSlot.teacher_user_id.is_not(None))))
    for t in teachers - {user.id}:
        db.add(Notice(user_id=t, school_id=school_id, kind="info", icon="calendar", text=f"The new timetable is out. See your lessons on your home page.", link="#/"))
    db.commit()
    return {"published_at": st.published_at.isoformat(), "told": len(teachers)}


# ---------- Endpoints: the grid ----------

def grid_for(db: Session, w: World, class_id: uuid.UUID | None = None, teacher_id: uuid.UUID | None = None, student: Student | None = None) -> dict:
    days = sorted(w.st.days or [0, 1, 2, 3, 4])
    cells: dict[str, dict] = {}
    if class_id or student:
        cid = class_id or student.class_id
        c = w.class_by_id.get(cid)
        if not c:
            raise not_found("Class")
        periods = w.periods_for(c)
        mine = {}
        if student:
            mine = {g: True for g in db.scalars(select(StudentElective.group_id).where(StudentElective.student_id == student.id, StudentElective.group_id.is_not(None)))}
        gslots = defaultdict(list)
        for gs in db.scalars(select(TimetableGroupSlot).where(TimetableGroupSlot.school_id == w.school_id)):
            g = w.group_by_id.get(gs.group_id)
            if g and g.level == c.level and g.branch_id == c.branch_id:
                gslots[(gs.weekday, gs.period_id)].append((g, gs))
        for s in db.scalars(select(TimetableSlot).where(TimetableSlot.class_id == cid)):
            key = f"{s.weekday}:{s.period_id}"
            if s.kind == "block":
                gs = gslots.get((s.weekday, s.period_id), [])
                if student:
                    own = next(((g, x) for g, x in gs if g.id in mine), None)
                    if own:
                        g, x = own
                        cells[key] = {"kind": "lesson", "subject": w.subjects[g.subject_id].name if g.subject_id in w.subjects else "?", "subject_id": str(g.subject_id),
                                      "teacher": w.names.get(x.teacher_user_id) or name(db, x.teacher_user_id), "group": g.name}
                        continue
                    cells[key] = {"kind": "free", "subject": "Private study", "block": s.block}
                    continue
                cells[key] = {"kind": "block", "block": s.block, "subjects": sorted({w.subjects[g.subject_id].name for g, _ in gs if g.subject_id in w.subjects}), "locked": s.locked}
            else:
                cells[key] = {"kind": "lesson", "subject": w.subjects[s.subject_id].name if s.subject_id in w.subjects else "?", "subject_id": str(s.subject_id) if s.subject_id else None,
                              "teacher": w.names.get(s.teacher_user_id) or name(db, s.teacher_user_id), "teacher_id": str(s.teacher_user_id) if s.teacher_user_id else None, "locked": s.locked}
        title = c.name
        form = w.names.get(c.form_teacher_id) or name(db, c.form_teacher_id)
    else:
        title = name(db, teacher_id) or "Teacher"
        form = None
        pids = set()
        for s in db.scalars(select(TimetableSlot).where(TimetableSlot.school_id == w.school_id, TimetableSlot.teacher_user_id == teacher_id)):
            c = w.class_by_id.get(s.class_id)
            cells[f"{s.weekday}:{s.period_id}"] = {"kind": "lesson", "subject": w.subjects[s.subject_id].name if s.subject_id in w.subjects else "?",
                                                   "subject_id": str(s.subject_id) if s.subject_id else None, "class": c.name if c else "?", "class_id": str(s.class_id)}
            pids.add(s.period_id)
        for gs in db.scalars(select(TimetableGroupSlot).where(TimetableGroupSlot.school_id == w.school_id, TimetableGroupSlot.teacher_user_id == teacher_id)):
            g = w.group_by_id.get(gs.group_id)
            cells[f"{gs.weekday}:{gs.period_id}"] = {"kind": "lesson", "subject": w.subjects[g.subject_id].name if g and g.subject_id in w.subjects else "?",
                                                     "subject_id": str(g.subject_id) if g else None, "class": g.name if g else "?", "group": True}
            pids.add(gs.period_id)
        periods = [p for p in w.all_periods if p.section_id is None or p.id in pids]
        if any(p.section_id for p in w.all_periods if p.id in pids):
            periods = sorted({p.id: p for p in w.all_periods if p.id in pids or (p.section_id is None and p.kind != PeriodKind.lesson)}.values(), key=lambda p: p.starts_at)
    return {"title": title, "form_teacher": form, "days": [{"n": d, "name": DAYS[d]} for d in days],
            "periods": [{"id": str(p.id), "name": p.name, "kind": p.kind.value, "starts_at": p.starts_at.strftime("%H:%M"), "ends_at": p.ends_at.strftime("%H:%M")} for p in periods],
            "cells": cells, "count": sum(1 for v in cells.values() if v["kind"] in ("lesson", "block"))}


def name(db: Session, uid: uuid.UUID | None) -> str | None:
    u = db.get(User, uid) if uid else None
    return u.full_name if u else None


@router.get("/schools/{school_id}/timetable")
def grid(school_id: uuid.UUID, class_id: uuid.UUID | None = None, teacher_id: uuid.UUID | None = None, user: User = Depends(current_user), db: Session = Depends(get_db)):
    need_school(db, user, school_id)
    w = World(db, school_id)
    if not class_id and not teacher_id:
        class_id = w.classes[0].id if w.classes else None
        if not class_id:
            raise not_found("Class")
    out = grid_for(db, w, class_id=class_id, teacher_id=teacher_id)
    out["options"] = {"classes": [{"id": str(c.id), "name": c.name, "level": c.level} for c in w.classes],
                      "teachers": sorted([{"id": str(k), "name": v} for k, v in w.names.items()], key=lambda x: x["name"])}
    if class_id:
        c = w.class_by_id[class_id]
        out["choices"] = [{"subject_id": str(cs.subject_id), "subject": w.subjects[cs.subject_id].name, "teacher": w.names.get(cs.teacher_user_id)}
                          for cs in w.class_subjects if cs.class_id == class_id and cs.subject_id in w.subjects]
        out["choices"].sort(key=lambda x: x["subject"])
        out["class_id"] = str(class_id)
    return out


@router.get("/schools/{school_id}/timetable/all")
def all_classes(school_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Every class's week at once, for printing."""
    need_school(db, user, school_id)
    w = World(db, school_id)
    school = db.get(School, school_id)
    return {"school": {"name": school.name, "logo": school.logo, "colour": school.colour}, "classes": [grid_for(db, w, class_id=c.id) for c in w.classes]}


@router.get("/classes/{class_id}/timetable/{weekday}/{period_id}/choices")
def cell_choices(class_id: uuid.UUID, weekday: int, period_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """The class's subjects, each saying whether its teacher is free at that time."""
    c = db.get(SchoolClass, class_id)
    if not c:
        raise not_found("Class")
    school_id = db.get(Branch, c.branch_id).school_id
    need_school(db, user, school_id)
    w = World(db, school_id)
    p = w.period_by_id.get(period_id)
    if not p:
        raise not_found("Period")
    a, b = mins(p.starts_at), mins(p.ends_at)
    busy: dict[uuid.UUID, str] = {}
    for o in db.scalars(select(TimetableSlot).where(TimetableSlot.school_id == school_id, TimetableSlot.weekday == weekday, TimetableSlot.teacher_user_id.is_not(None),
                                                    TimetableSlot.class_id != class_id)):
        op = w.period_by_id.get(o.period_id)
        if op and mins(op.starts_at) < b and a < mins(op.ends_at):
            busy[o.teacher_user_id] = f"teaching {w.class_by_id[o.class_id].name}" if o.class_id in w.class_by_id else "teaching"
    for o in db.scalars(select(TimetableGroupSlot).where(TimetableGroupSlot.school_id == school_id, TimetableGroupSlot.weekday == weekday, TimetableGroupSlot.teacher_user_id.is_not(None))):
        op = w.period_by_id.get(o.period_id)
        if op and mins(op.starts_at) < b and a < mins(op.ends_at):
            busy[o.teacher_user_id] = "with an options group"
    out = [{"subject_id": str(cs.subject_id), "subject": w.subjects[cs.subject_id].name, "teacher": w.names.get(cs.teacher_user_id),
            "busy": busy.get(cs.teacher_user_id) if cs.teacher_user_id else None}
           for cs in w.class_subjects if cs.class_id == class_id and cs.subject_id in w.subjects]
    return sorted(out, key=lambda x: (bool(x["busy"]), x["subject"]))


class CellIn(BaseModel):
    subject_id: uuid.UUID | None = None
    locked: bool | None = None


@router.put("/classes/{class_id}/timetable/{weekday}/{period_id}")
def set_cell(class_id: uuid.UUID, weekday: int, period_id: uuid.UUID, data: CellIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    c = db.get(SchoolClass, class_id)
    if not c:
        raise not_found("Class")
    school_id = db.get(Branch, c.branch_id).school_id
    need_school(db, user, school_id)
    w = World(db, school_id)
    p = w.period_by_id.get(period_id)
    if not p or p.kind != PeriodKind.lesson or p not in w.periods_for(c):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "That is not a lesson period for this class")
    slot = db.scalar(select(TimetableSlot).where(TimetableSlot.class_id == class_id, TimetableSlot.weekday == weekday, TimetableSlot.period_id == period_id))
    if slot and slot.kind == "block" and data.subject_id:
        raise HTTPException(status.HTTP_409_CONFLICT, "This is an options block for the whole level. Rebuild to move it.")
    if data.subject_id is None and data.locked is None:
        if slot and slot.kind == "lesson":
            db.delete(slot)
        db.commit()
        return grid(school_id, class_id, None, user, db)
    if data.subject_id:
        cs = next((x for x in w.class_subjects if x.class_id == class_id and x.subject_id == data.subject_id), None)
        if not cs:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "This class doesn't take that subject")
        t = cs.teacher_user_id
        if t:
            a, b = mins(p.starts_at), mins(p.ends_at)
            for other in db.scalars(select(TimetableSlot).where(TimetableSlot.school_id == school_id, TimetableSlot.weekday == weekday, TimetableSlot.teacher_user_id == t,
                                                                TimetableSlot.class_id != class_id)):
                op = w.period_by_id.get(other.period_id)
                if op and mins(op.starts_at) < b and a < mins(op.ends_at):
                    raise HTTPException(status.HTTP_409_CONFLICT, f"{w.names.get(t, 'The teacher')} is teaching {w.class_by_id[other.class_id].name} then")
            for other in db.scalars(select(TimetableGroupSlot).where(TimetableGroupSlot.school_id == school_id, TimetableGroupSlot.weekday == weekday, TimetableGroupSlot.teacher_user_id == t)):
                op = w.period_by_id.get(other.period_id)
                if op and mins(op.starts_at) < b and a < mins(op.ends_at):
                    raise HTTPException(status.HTTP_409_CONFLICT, f"{w.names.get(t, 'The teacher')} has an options group then")
        if not slot:
            slot = TimetableSlot(school_id=school_id, class_id=class_id, weekday=weekday, period_id=period_id, kind="lesson")
            db.add(slot)
        slot.subject_id, slot.teacher_user_id = data.subject_id, t
        slot.locked = True if data.locked is None else data.locked
    elif slot:
        slot.locked = bool(data.locked)
    db.commit()
    return grid(school_id, class_id, None, user, db)


# ---------- My week (staff), and a child's week (family) ----------

def now_next(w: World, cells: dict, periods: list[dict], today: int, now_min: int) -> dict:
    todays = []
    for p in periods:
        cell = cells.get(f"{today}:{p['id']}")
        a = int(p["starts_at"][:2]) * 60 + int(p["starts_at"][3:])
        b = int(p["ends_at"][:2]) * 60 + int(p["ends_at"][3:])
        todays.append({**p, "cell": cell, "state": "done" if b <= now_min else "now" if a <= now_min < b else "next"})
    return {"today": todays, "now": next((x for x in todays if x["state"] == "now"), None),
            "next": next((x for x in todays if x["state"] == "next" and x["cell"] and x["cell"]["kind"] != "free"), None)}


@router.get("/me/schools/{school_id}/timetable")
def my_timetable(school_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    school = db.get(School, school_id)
    if not school or not any(m.school_id == school_id for m in user.memberships):
        raise not_found("School")
    w = World(db, school_id)
    out = grid_for(db, w, teacher_id=user.id)
    now = now_wat()
    out.update(now_next(w, out["cells"], out["periods"], now.weekday(), now.hour * 60 + now.minute))
    covers = list(db.scalars(select(CoverLesson).where(CoverLesson.cover_user_id == user.id, CoverLesson.on_date >= now.date(), CoverLesson.on_date <= now.date() + timedelta(days=6))))
    out["covers"] = [cover_out(db, w, c) for c in covers]
    out["published"] = bool(w.st.published_at)
    out["week_lessons"] = out["count"]
    return out


def child_timetable(db: Session, s: Student) -> dict | None:
    if not s.class_id:
        return None
    w = World(db, s.school_id)
    if not w.st.published_at:
        return None
    out = grid_for(db, w, student=s)
    now = now_wat()
    out.update(now_next(w, out["cells"], out["periods"], now.weekday(), now.hour * 60 + now.minute))
    return out


# ---------- Cover ----------

def cover_out(db: Session, w: World, c: CoverLesson) -> dict:
    p = w.period_by_id.get(c.period_id)
    cl = w.class_by_id.get(c.class_id) if c.class_id else None
    g = w.group_by_id.get(c.group_id) if c.group_id else None
    return {"id": str(c.id), "date": c.on_date.isoformat(), "period": p.name if p else "?", "starts_at": p.starts_at.strftime("%H:%M") if p else None,
            "class": cl.name if cl else g.name if g else "?", "subject": w.subjects[c.subject_id].name if c.subject_id in w.subjects else None,
            "absent": name(db, c.absent_user_id), "cover": name(db, c.cover_user_id), "note": c.note}


def away_on(db: Session, school_id: uuid.UUID, day: date) -> dict[uuid.UUID, str]:
    away = {}
    for a in db.scalars(select(StaffAttendance).where(StaffAttendance.school_id == school_id, StaffAttendance.on_date == day, StaffAttendance.status.in_(["absent", "excused"]))):
        away[a.user_id] = "Absent today" if a.status == "absent" else "Excused today"
    for l in db.scalars(select(LeaveRequest).where(LeaveRequest.school_id == school_id, LeaveRequest.status == "approved", LeaveRequest.starts_on <= day, LeaveRequest.ends_on >= day)):
        away[l.user_id] = f"On {l.kind} leave"
    return away


@router.get("/schools/{school_id}/covers")
def covers(school_id: uuid.UUID, on: date | None = None, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Who is away on a day, the lessons that need someone, and who is free to take them."""
    need_school(db, user, school_id)
    day = on or now_wat().date()
    w = World(db, school_id)
    wd = day.weekday()
    away = away_on(db, school_id, day)
    done = {(c.period_id, c.class_id, c.group_id): c for c in db.scalars(select(CoverLesson).where(CoverLesson.school_id == school_id, CoverLesson.on_date == day))}
    # Everyone's lessons that day, to know who is free when.
    busy = defaultdict(list)
    for s in db.scalars(select(TimetableSlot).where(TimetableSlot.school_id == school_id, TimetableSlot.weekday == wd, TimetableSlot.teacher_user_id.is_not(None))):
        busy[s.teacher_user_id].append(s.period_id)
    for s in db.scalars(select(TimetableGroupSlot).where(TimetableGroupSlot.school_id == school_id, TimetableGroupSlot.weekday == wd, TimetableGroupSlot.teacher_user_id.is_not(None))):
        busy[s.teacher_user_id].append(s.period_id)
    for c in done.values():
        if c.cover_user_id:
            busy[c.cover_user_id].append(c.period_id)
    teachers = set(db.scalars(select(Membership.user_id).where(Membership.school_id == school_id, Membership.role.in_([Role.teacher, Role.vice_principal, Role.head]))))
    week_start = day - timedelta(days=wd)
    cover_count = Counter(db.scalars(select(CoverLesson.cover_user_id).where(CoverLesson.school_id == school_id, CoverLesson.on_date >= week_start, CoverLesson.on_date < week_start + timedelta(days=7))))
    from app.models import StaffProfile
    dept = dict(db.execute(select(StaffProfile.user_id, StaffProfile.department_id).where(StaffProfile.school_id == school_id)).all())

    def span(pid):
        p = w.period_by_id[pid]
        return mins(p.starts_at), mins(p.ends_at)

    def free_at(pid, absent):
        a, b = span(pid)
        out = []
        for t in teachers - set(away):
            if any(span(x)[0] < b and a < span(x)[1] for x in busy.get(t, []) if x in w.period_by_id):
                continue
            out.append({"id": str(t), "name": name(db, t), "same_department": bool(dept.get(t) and dept.get(t) == dept.get(absent)), "covers_this_week": cover_count.get(t, 0),
                        "lessons_today": len(busy.get(t, []))})
        return sorted(out, key=lambda x: (not x["same_department"], x["covers_this_week"], x["lessons_today"], x["name"] or ""))[:6]

    need = []
    for t, why in away.items():
        rows = [(s.period_id, s.class_id, None, s.subject_id) for s in db.scalars(select(TimetableSlot).where(TimetableSlot.school_id == school_id, TimetableSlot.weekday == wd, TimetableSlot.teacher_user_id == t))]
        rows += [(s.period_id, None, s.group_id, w.group_by_id[s.group_id].subject_id if s.group_id in w.group_by_id else None)
                 for s in db.scalars(select(TimetableGroupSlot).where(TimetableGroupSlot.school_id == school_id, TimetableGroupSlot.weekday == wd, TimetableGroupSlot.teacher_user_id == t))]
        lessons = []
        for pid, cid, gid, sub in sorted(rows, key=lambda r: w.period_by_id[r[0]].starts_at if r[0] in w.period_by_id else time(0)):
            if pid not in w.period_by_id:
                continue
            p = w.period_by_id[pid]
            c = done.get((pid, cid, gid))
            lessons.append({"period_id": str(pid), "period": p.name, "starts_at": p.starts_at.strftime("%H:%M"), "class_id": str(cid) if cid else None, "group_id": str(gid) if gid else None,
                            "class": w.class_by_id[cid].name if cid else (w.group_by_id[gid].name if gid in w.group_by_id else "?"),
                            "subject": w.subjects[sub].name if sub in w.subjects else None, "subject_id": str(sub) if sub else None,
                            "cover": cover_out(db, w, c) if c else None, "free": [] if c else free_at(pid, t)})
        if lessons:
            need.append({"teacher_id": str(t), "teacher": name(db, t), "why": why, "lessons": lessons})
    return {"date": day.isoformat(), "weekday": DAYS[wd], "away": need, "covered": sum(1 for n in need for l in n["lessons"] if l["cover"]),
            "to_cover": sum(1 for n in need for l in n["lessons"] if not l["cover"]), "away_count": len(away)}


class CoverIn(BaseModel):
    on_date: date
    period_id: uuid.UUID
    class_id: uuid.UUID | None = None
    group_id: uuid.UUID | None = None
    subject_id: uuid.UUID | None = None
    absent_user_id: uuid.UUID | None = None
    cover_user_id: uuid.UUID
    note: str | None = Field(default=None, max_length=200)


@router.post("/schools/{school_id}/covers", status_code=201)
def add_cover(school_id: uuid.UUID, data: CoverIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    need_school(db, user, school_id)
    w = World(db, school_id)
    p = w.period_by_id.get(data.period_id)
    if not p or not (data.class_id or data.group_id):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Choose the lesson")
    if db.scalar(select(CoverLesson.id).where(CoverLesson.school_id == school_id, CoverLesson.on_date == data.on_date, CoverLesson.period_id == data.period_id,
                                              CoverLesson.class_id == data.class_id, CoverLesson.group_id == data.group_id)):
        raise HTTPException(status.HTTP_409_CONFLICT, "Someone is already covering this lesson")
    c = CoverLesson(school_id=school_id, by_id=user.id, **data.model_dump())
    db.add(c)
    db.flush()
    o = cover_out(db, w, c)
    db.add(Notice(user_id=data.cover_user_id, school_id=school_id, kind="request", icon="calendar",
                  text=f"Please cover {o['class']}{' ' + o['subject'] if o['subject'] else ''}, {o['period']} ({o['starts_at']}) on {data.on_date:%a %d %b}"
                       + (f" for {o['absent']}" if o['absent'] else "") + ".", link="#/"))
    db.commit()
    return o


@router.delete("/covers/{cover_id}", status_code=204)
def remove_cover(cover_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    c = db.get(CoverLesson, cover_id)
    if not c:
        raise not_found("Cover")
    need_school(db, user, c.school_id)
    if c.cover_user_id:
        db.add(Notice(user_id=c.cover_user_id, school_id=c.school_id, kind="info", icon="calendar", text=f"You no longer need to cover a lesson on {c.on_date:%a %d %b}."))
    db.delete(c)
    db.commit()
