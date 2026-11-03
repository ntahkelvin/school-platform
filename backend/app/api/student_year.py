"""The student list with everything at a glance, student ID cards, end-of-year promotion (with undo) and leaving the school."""
import uuid
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.access import check, not_found
from app.api.academics import _level_order
from app.api.deps import current_user
from app.api.staff_day import now_wat
from app.core import rights
from app.api.family import student_login_active
from app.core.db import get_db
from app.models import (
    AttendanceRecord, Bed, Branch, ConductEntry, House, Loan, PromotionRun, School, SchoolClass, Student, StudentDocument,
    StudentEvent, StudentGuardian, StudentHealth, User,
)
from app.models.attendance import AttendanceKind, AttendanceStatus
from app.models.people import StudentStatus

router = APIRouter(prefix="/api", tags=["students"])


def need_school(db: Session, user: User, school_id: uuid.UUID) -> School:
    s = db.get(School, school_id)
    if not s:
        raise not_found("School")
    check(user, s, "students")
    return s


# ---------- The list ----------

@router.get("/schools/{school_id}/student-list")
def student_list(school_id: uuid.UUID, include_left: bool = False, branch_id: uuid.UUID | None = None, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Every student with the things worth seeing in a list: photo, house, alerts and what is missing from their profile."""
    need_school(db, user, school_id)
    q = select(Student).where(Student.school_id == school_id)
    if not include_left:
        q = q.where(Student.status == StudentStatus.active)
    if branch_id:
        q = q.where(Student.branch_id == branch_id)
    studs = list(db.scalars(q.order_by(Student.last_name, Student.first_name)))
    return build_rows(db, school_id, studs)


def build_rows(db: Session, school_id: uuid.UUID, studs: list[Student]) -> list[dict]:
    ids = [s.id for s in studs] or [uuid.uuid4()]
    houses = {h.id: h for h in db.scalars(select(House).where(House.school_id == school_id))}
    classes = {c.id: c for c in db.scalars(select(SchoolClass).join(Branch, Branch.id == SchoolClass.branch_id).where(Branch.school_id == school_id))}
    guardians = defaultdict(list)
    for g in db.scalars(select(StudentGuardian).where(StudentGuardian.student_id.in_(ids))):
        guardians[g.student_id].append(g)
    health = {h.student_id: h for h in db.scalars(select(StudentHealth).where(StudentHealth.student_id.in_(ids)))}
    docs = defaultdict(set)
    for sid, kind in db.execute(select(StudentDocument.student_id, StudentDocument.kind).where(StudentDocument.student_id.in_(ids))):
        docs[sid].add(kind)
    beds = {b.student_id: b for b in db.scalars(select(Bed).where(Bed.student_id.in_(ids)))}
    today = now_wat().date()
    late_books = Counter(db.scalars(select(Loan.student_id).where(Loan.student_id.in_(ids), Loan.returned_at.is_(None), Loan.due_on < today)))
    since = today - timedelta(days=30)
    att = defaultdict(lambda: [0, 0])
    for sid, st, n in db.execute(select(AttendanceRecord.student_id, AttendanceRecord.status, func.count()).where(
            AttendanceRecord.student_id.in_(ids), AttendanceRecord.kind == AttendanceKind.school, AttendanceRecord.on_date >= since)
            .group_by(AttendanceRecord.student_id, AttendanceRecord.status)):
        att[sid][1] += n
        if st in (AttendanceStatus.present, AttendanceStatus.late):
            att[sid][0] += n
    points = dict(db.execute(select(ConductEntry.student_id, func.sum(ConductEntry.points)).where(
        ConductEntry.student_id.in_(ids), ConductEntry.created_at >= datetime.now(timezone.utc) - timedelta(days=90)).group_by(ConductEntry.student_id)).all())
    rows = []
    for s in studs:
        gs = guardians[s.id]
        h = health.get(s.id)
        # The same checks as the profile's "profile complete" ring.
        checks = [("photo", bool(s.photo)), ("date of birth", bool(s.date_of_birth)), ("state and LGA", bool(s.state_of_origin and s.lga)),
                  ("home address", bool(s.home_address)), ("class", bool(s.class_id)), ("house", bool(s.house_id)),
                  ("parent phone", any(g.user.phone for g in gs)), ("main contact", any(g.is_primary for g in gs)), ("health record", bool(h)),
                  ("birth certificate", "birth_certificate" in docs[s.id]), ("passport photo", "passport_photo" in docs[s.id] or bool(s.photo)),
                  ("date admitted", bool(s.admitted_on))]
        missing = [n for n, ok in checks if not ok]
        c = classes.get(s.class_id)
        hs = houses.get(s.house_id)
        a = att.get(s.id)
        rows.append({"id": str(s.id), "admission_no": s.admission_no, "first_name": s.first_name, "middle_name": s.middle_name, "last_name": s.last_name,
                     "nickname": s.nickname, "gender": s.gender.value, "boarding_status": s.boarding_status.value, "status": s.status.value,
                     "date_of_birth": s.date_of_birth.isoformat() if s.date_of_birth else None, "thumb": s.photo_thumb,
                     "class_id": str(s.class_id) if s.class_id else None, "class_name": c.name if c else None, "level": c.level if c else None,
                     "house_id": str(s.house_id) if s.house_id else None, "house": hs.name if hs else None, "house_colour": hs.colour if hs else None,
                     "leadership": s.leadership, "state_of_origin": s.state_of_origin, "lga": s.lga, "religion": s.religion,
                     "parent": next((f"{g.user.full_name} {g.user.phone or ''}".strip() for g in sorted(gs, key=lambda g: not g.is_primary)), None),
                     "allergy": h.allergies if h else None, "late_books": late_books.get(s.id, 0),
                     "attendance": round(100 * a[0] / a[1]) if a and a[1] else None, "points": int(points.get(s.id) or 0),
                     "missing": missing, "complete": round(100 * (len(checks) - len(missing)) / len(checks))})
    return rows


# ---------- One class ----------

@router.get("/classes/{class_id}/page")
def class_page(class_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Everything about one class: its students, today's register, subjects and teachers, and its week."""
    from app.models import ClassSubject, Subject
    from app.models.attendance import AttendanceRecord as AR
    c = db.get(SchoolClass, class_id)
    if not c:
        raise not_found("Class")
    branch = db.get(Branch, c.branch_id)
    school = db.get(School, branch.school_id)
    full = rights.has(user, school, "students.see", db)
    teaches = db.scalar(select(ClassSubject.id).where(ClassSubject.class_id == c.id, ClassSubject.teacher_user_id == user.id))
    why = "Students" if full else "Form teacher" if c.form_teacher_id == user.id else "Subject teacher" if teaches else None
    if not why:
        raise not_found("Class")
    studs = list(db.scalars(select(Student).where(Student.class_id == c.id, Student.status == StudentStatus.active).order_by(Student.last_name, Student.first_name)))
    rows = build_rows(db, school.id, studs)
    if not full:
        for r in rows:
            r.pop("parent", None)
            r.pop("missing", None)
    today = now_wat().date()
    marks = {sid: st.value for sid, st in db.execute(select(AR.student_id, AR.status).where(AR.class_id == c.id, AR.on_date == today, AR.kind == AttendanceKind.school))}
    for r in rows:
        r["today"] = marks.get(uuid.UUID(r["id"]))
    subjects = [{"subject": sub.name, "teacher": u.full_name if u else None, "teacher_id": str(u.id) if u else None, "elective": not cs.compulsory}
                for cs, sub, u in db.execute(select(ClassSubject, Subject, User).join(Subject, Subject.id == ClassSubject.subject_id)
                                             .outerjoin(User, User.id == ClassSubject.teacher_user_id).where(ClassSubject.class_id == c.id).order_by(Subject.name))]
    ft = db.get(User, c.form_teacher_id) if c.form_teacher_id else None
    timetable = None
    try:
        from app.api.timetable import World, grid_for
        w = World(db, school.id)
        if w.st.built_at and (w.st.published_at or rights.has(user, school, "teaching.see", db)):
            timetable = grid_for(db, w, class_id=c.id)
    except HTTPException:
        timetable = None
    counts = Counter(r["today"] for r in rows)
    att = [r["attendance"] for r in rows if r["attendance"] is not None]
    tips = []
    low = sorted([r for r in rows if r["attendance"] is not None and r["attendance"] < 85], key=lambda r: r["attendance"])
    if low:
        tips.append({"kind": "alert", "icon": "attendance", "text": f"{len(low)} below 85% attendance this month, lowest {low[0]['first_name']} {low[0]['last_name']} ({low[0]['attendance']}%)."})
    stars = sorted([r for r in rows if r["points"] >= 10], key=lambda r: -r["points"])
    if stars:
        tips.append({"kind": "strength", "icon": "star", "text": f"Most merit points: {', '.join(r['first_name'] for r in stars[:3])}."})
    soon = []
    for s in studs:
        if s.date_of_birth:
            try:
                nxt = s.date_of_birth.replace(year=today.year)
            except ValueError:
                nxt = date(today.year, 3, 1)
            if 0 <= (nxt - today).days <= 7:
                soon.append(s.first_name)
    if soon:
        tips.append({"kind": "strength", "icon": "sparkle", "text": f"Birthday this week: {', '.join(soon)} 🎂"})
    allergic = [r for r in rows if r["allergy"]]
    if allergic:
        tips.append({"kind": "tip", "icon": "circle-x", "text": f"{len(allergic)} with allergies: " + ", ".join(f"{r['first_name']} ({r['allergy']})" for r in allergic[:4]) + "."})
    late = sum(r["late_books"] for r in rows)
    if late:
        tips.append({"kind": "tip", "icon": "book", "text": f"{late} late library book{'s' if late > 1 else ''} in this class."})
    return {"class": {"id": str(c.id), "name": c.name, "level": c.level, "branch_id": str(branch.id)},
            "school": {"id": str(school.id), "name": school.name, "colour": school.colour},
            "form_teacher": {"id": str(ft.id), "name": ft.full_name} if ft else None, "why": why, "full": full,
            "can_mark": full and rights.has(user, school, "attendance.change", db) or c.form_teacher_id == user.id,
            "students": rows, "boys": sum(1 for r in rows if r["gender"] == "male"), "girls": sum(1 for r in rows if r["gender"] == "female"),
            "boarders": sum(1 for r in rows if r["boarding_status"] == "boarder"),
            "today": {"taken": bool(marks), "present": counts.get("present", 0) + counts.get("late", 0), "absent": counts.get("absent", 0),
                      "late": counts.get("late", 0), "unmarked": counts.get(None, 0), "date": today.isoformat()},
            "attendance": round(sum(att) / len(att)) if att else None, "points": sum(r["points"] for r in rows),
            "subjects": subjects, "timetable": timetable, "insights": tips}


# ---------- ID cards ----------

@router.get("/schools/{school_id}/student-cards")
def cards(school_id: uuid.UUID, class_id: uuid.UUID | None = None, ids: str | None = None, user: User = Depends(current_user), db: Session = Depends(get_db)):
    school = need_school(db, user, school_id)
    q = select(Student).where(Student.school_id == school_id, Student.status == StudentStatus.active)
    if class_id:
        q = q.where(Student.class_id == class_id)
    if ids:
        want = []
        for x in ids.split(","):
            try:
                want.append(uuid.UUID(x))
            except ValueError:
                pass
        q = q.where(Student.id.in_(want or [uuid.uuid4()]))
    studs = list(db.scalars(q.order_by(Student.last_name, Student.first_name).limit(400)))
    houses = {h.id: h for h in db.scalars(select(House).where(House.school_id == school_id))}
    out = []
    for s in studs:
        g = next((g for g in sorted(s.guardians, key=lambda g: not g.is_primary) if g.user.phone), None)
        hs = houses.get(s.house_id)
        out.append({"id": str(s.id), "name": s.full_name, "admission_no": s.admission_no, "class_name": s.school_class.name if s.school_class else None,
                    "house": hs.name if hs else None, "house_colour": hs.colour if hs else None, "photo": s.photo, "boarder": s.boarding_status.value == "boarder",
                    "emergency": g.user.phone if g else None, "code": f"SP1:P:{school.id.hex[:8]}:{s.id.hex}"})
    year = now_wat().date().year
    session = f"{year}/{year + 1}" if now_wat().date().month >= 9 else f"{year - 1}/{year}"
    return {"school": {"name": school.name, "logo": school.logo, "colour": school.colour, "motto": school.motto, "address": school.address, "phone": school.phone},
            "session": session, "cards": out}


# ---------- End of year ----------

def school_classes(db: Session, school_id: uuid.UUID) -> list[SchoolClass]:
    return list(db.scalars(select(SchoolClass).join(Branch, Branch.id == SchoolClass.branch_id).where(Branch.school_id == school_id)
                           .order_by(SchoolClass.level_order, SchoolClass.arm)))


@router.get("/schools/{school_id}/promotion/plan")
def plan(school_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Where each class goes next year: the same arm one level up; the top level graduates."""
    need_school(db, user, school_id)
    classes = school_classes(db, school_id)
    counts = Counter(db.scalars(select(Student.class_id).where(Student.school_id == school_id, Student.status == StudentStatus.active)))
    rows = []
    for c in classes:
        levels = sorted({x.level for x in classes if x.branch_id == c.branch_id}, key=_level_order)
        i = levels.index(c.level)
        nxt_level = levels[i + 1] if i + 1 < len(levels) else None
        # Primary 6 goes to JSS 1 only if the school has JSS; otherwise they finish.
        target = None
        if nxt_level:
            here = [x for x in classes if x.level == nxt_level and x.branch_id == c.branch_id]
            target = next((x for x in here if x.arm == c.arm), None) or (here[0] if here else None)
        rows.append({"class_id": str(c.id), "name": c.name, "level": c.level, "students": counts.get(c.id, 0),
                     "to": str(target.id) if target else "graduate", "to_name": target.name if target else "Graduate (leave the school)",
                     "missing_arm": bool(nxt_level and target and target.arm != c.arm)})
    runs = [{"id": str(r.id), "label": r.label, "at": r.created_at.isoformat(), "undone": r.undone, "summary": r.summary,
             "by": (db.get(User, r.by_id).full_name if r.by_id and db.get(User, r.by_id) else None)}
            for r in db.scalars(select(PromotionRun).where(PromotionRun.school_id == school_id).order_by(PromotionRun.created_at.desc()).limit(10))]
    return {"classes": rows, "options": [{"id": str(c.id), "name": c.name} for c in classes], "no_class": counts.get(None, 0), "runs": runs}


class Move(BaseModel):
    class_id: uuid.UUID
    to: str                     # a class id, "graduate", or "stay"


class RunIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    label: str = Field(min_length=2, max_length=80)
    moves: list[Move] = Field(max_length=300)
    hold_back: list[uuid.UUID] = Field(default_factory=list, max_length=500)   # repeating the class


@router.post("/schools/{school_id}/promotion/run")
def run(school_id: uuid.UUID, data: RunIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    school = need_school(db, user, school_id)
    if not rights.has(user, school, "students.change", db) or rights.acting(user):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only people who can change students can do this")
    classes = {c.id: c for c in school_classes(db, school_id)}
    target = {}
    for m in data.moves:
        if m.class_id not in classes:
            raise not_found("Class")
        if m.to not in ("graduate", "stay"):
            try:
                tid = uuid.UUID(m.to)
            except ValueError:
                raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Choose where each class goes")
            if tid not in classes:
                raise not_found("Class")
            target[m.class_id] = tid
        else:
            target[m.class_id] = m.to
    studs = list(db.scalars(select(Student).where(Student.school_id == school_id, Student.status == StudentStatus.active, Student.class_id.in_(list(target)))))
    hold = set(data.hold_back)
    snapshot, promoted, graduated, held = [], 0, 0, 0
    today = now_wat().date()
    # Work out every move from where students are now, then apply, so classes moving into each other don't mix.
    for s in studs:
        snapshot.append({"student_id": str(s.id), "class_id": str(s.class_id), "status": s.status.value, "left_on": s.left_on.isoformat() if s.left_on else None})
        to = target[s.class_id]
        old = classes[s.class_id].name
        if s.id in hold or to == "stay":
            if s.id in hold:
                held += 1
                db.add(StudentEvent(student_id=s.id, kind="class", text=f"Repeating {old} ({data.label})", by_id=user.id))
            continue
        if to == "graduate":
            s.status, s.left_on, s.leave_reason = StudentStatus.graduated, today, s.leave_reason or "Finished school"
            student_login_active(db, s, False)
            graduated += 1
            db.add(StudentEvent(student_id=s.id, kind="status", text=f"Graduated from {old} ({data.label})", by_id=user.id))
        else:
            s.class_id = to
            promoted += 1
            db.add(StudentEvent(student_id=s.id, kind="class", text=f"Promoted from {old} to {classes[to].name} ({data.label})", by_id=user.id))
    if not snapshot:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "There are no students in those classes to move")
    r = PromotionRun(school_id=school_id, label=data.label, by_id=user.id, snapshot=snapshot,
                     summary={"promoted": promoted, "graduated": graduated, "held": held})
    db.add(r)
    db.commit()
    return {"id": str(r.id), **r.summary}


@router.post("/promotion-runs/{run_id}/undo")
def undo(run_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    r = db.get(PromotionRun, run_id)
    if not r:
        raise not_found("Promotion")
    school = need_school(db, user, r.school_id)
    if not rights.has(user, school, "students.change", db) or rights.acting(user):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only people who can change students can do this")
    if r.undone:
        raise HTTPException(status.HTTP_409_CONFLICT, "Already undone")
    later = db.scalar(select(PromotionRun.id).where(PromotionRun.school_id == r.school_id, PromotionRun.created_at > r.created_at, PromotionRun.undone.is_(False)))
    if later:
        raise HTTPException(status.HTTP_409_CONFLICT, "Undo the later promotion first")
    n = 0
    for x in r.snapshot:
        s = db.get(Student, uuid.UUID(x["student_id"]))
        if not s:
            continue
        s.class_id = uuid.UUID(x["class_id"]) if x["class_id"] and x["class_id"] != "None" else None
        s.status = StudentStatus(x["status"])
        s.left_on = date.fromisoformat(x["left_on"]) if x["left_on"] else None
        student_login_active(db, s, s.status == StudentStatus.active)
        db.add(StudentEvent(student_id=s.id, kind="class", text=f"Promotion “{r.label}” undone", by_id=user.id))
        n += 1
    r.undone = True
    db.commit()
    return {"restored": n}


# ---------- Leaving ----------

class LeaveIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    status: str = Field(pattern="^(withdrawn|graduated|active)$")
    left_on: date | None = None
    reason: str | None = Field(default=None, max_length=200)
    next_school: str | None = Field(default=None, max_length=150)


@router.post("/students/{student_id}/leave")
def leave(student_id: uuid.UUID, data: LeaveIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    s = db.get(Student, student_id)
    if not s:
        raise not_found("Student")
    school = db.get(School, s.school_id)
    if not rights.has(user, school, "students.change", db) or rights.acting(user):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only people who can change students can do this")
    new = StudentStatus(data.status)
    if new == StudentStatus.active:
        s.status, s.left_on, s.leave_reason, s.next_school = new, None, None, None
        student_login_active(db, s, True)
        db.add(StudentEvent(student_id=s.id, kind="status", text="Back on the roll", by_id=user.id))
    else:
        s.status, s.left_on = new, data.left_on or now_wat().date()
        s.leave_reason, s.next_school = data.reason, data.next_school
        student_login_active(db, s, False)
        db.add(StudentEvent(student_id=s.id, kind="status", text=("Graduated" if new == StudentStatus.graduated else "Left the school")
                            + (f": {data.reason}" if data.reason else "") + (f" (to {data.next_school})" if data.next_school else ""), by_id=user.id))
        # Free their bed and take them off bus routes.
        bed = db.scalar(select(Bed).where(Bed.student_id == s.id))
        if bed:
            bed.student_id = None
        from app.models import RouteRider
        for rr in db.scalars(select(RouteRider).where(RouteRider.student_id == s.id)):
            db.delete(rr)
    db.commit()
    return {"status": s.status.value}


@router.get("/students/{student_id}/letter")
def letter(student_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """What a transfer letter or testimonial needs: the school's letterhead, the student, and their record in brief."""
    s = db.get(Student, student_id)
    if not s:
        raise not_found("Student")
    school = db.get(School, s.school_id)
    check(user, school, "students")
    from app.models import Membership, Role, StudentAward
    head = db.scalar(select(User).join(Membership, Membership.user_id == User.id).where(Membership.school_id == school.id, Membership.role == Role.head))
    att = db.execute(select(func.count(), func.count().filter(AttendanceRecord.status.in_([AttendanceStatus.present, AttendanceStatus.late])))
                     .where(AttendanceRecord.student_id == s.id, AttendanceRecord.kind == AttendanceKind.school)).first()
    pts = db.scalar(select(func.sum(ConductEntry.points)).where(ConductEntry.student_id == s.id)) or 0
    awards = [w.title for w in db.scalars(select(StudentAward).where(StudentAward.student_id == s.id).order_by(StudentAward.on_date.desc()).limit(5))]
    return {"school": {"name": school.name, "logo": school.logo, "motto": school.motto, "address": school.address, "phone": school.phone, "email": school.email,
                       "colour": school.colour, "approval_number": school.approval_number},
            "head": head.full_name if head else None,
            "student": {"name": s.full_name, "first_name": s.first_name, "gender": s.gender.value, "admission_no": s.admission_no,
                        "date_of_birth": s.date_of_birth.isoformat() if s.date_of_birth else None, "class_name": s.school_class.name if s.school_class else None,
                        "admitted_on": s.admitted_on.isoformat() if s.admitted_on else None, "entry_class": s.entry_class, "left_on": s.left_on.isoformat() if s.left_on else None,
                        "status": s.status.value, "next_school": s.next_school, "leave_reason": s.leave_reason, "leadership": s.leadership,
                        "state_of_origin": s.state_of_origin},
            "record": {"attendance": round(100 * (att[1] or 0) / att[0]) if att and att[0] else None, "points": int(pts), "awards": awards},
            "today": now_wat().date().isoformat()}
