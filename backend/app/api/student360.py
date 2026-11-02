"""Student 360: one profile that gathers everything the school knows about a student.

Who sees what:
- people with the Students right see the whole profile (and change it with Students: change);
- the student's own teachers (form teacher, subject teachers, teaching groups), their house master and house parents,
  and patrons of their clubs see the school-life parts, can give merits and add notes, but not addresses, ID numbers or documents;
- medical details need the medical-records right (allergies and diet are always shown, for safety);
- incidents and private notes need the safeguarding right.
"""
import re
import uuid
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Response, UploadFile, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.access import not_found
from app.api.deps import current_user
from app.api.staff_day import now_wat
from app.core import rights
from app.core.db import get_db
from app.models import (
    AttendanceRecord, Bed, Book, Branch, BusRoute, ClassSubject, ClinicVisit, Club, ConductEntry, GatePass, Hostel, HostelRoom, House,
    Incident, Loan, Membership, Role, School, SchoolClass, Student, StudentAward, StudentClub, StudentContact, StudentDocument,
    StudentElective, StudentEvent, StudentGuardian, StudentHealth, StudentNote, Subject, TeachingGroup, User, Visitor,
)
from app.models.attendance import AttendanceStatus
from app.models.people import BoardingStatus, StudentStatus

router = APIRouter(prefix="/api", tags=["students"])

MERITS = {"kindness": ("Kindness and helping", 2), "leadership": ("Leadership", 3), "academic": ("Good work", 2), "effort": ("Effort", 1),
          "sports": ("Sports and games", 2), "arts": ("Arts and culture", 2), "service": ("Service to the school", 3), "honesty": ("Honesty", 3)}
DEMERITS = {"late": ("Lateness", -1), "uniform": ("Uniform", -1), "homework": ("No homework", -1), "noise": ("Noise or disturbance", -1),
            "disrespect": ("Disrespect", -2), "fighting": ("Fighting", -3), "bounds": ("Out of bounds", -2), "phone": ("Phone or banned item", -2),
            "dishonesty": ("Dishonesty", -3)}
DOC_KINDS = {"birth_certificate": "Birth certificate", "passport_photo": "Passport photo", "previous_report": "Previous school report",
             "transfer_letter": "Transfer letter", "immunisation": "Immunisation card", "medical": "Medical report", "consent": "Consent form",
             "other": "Other"}
NEEDED_DOCS = ("birth_certificate", "passport_photo")
ALLOWED = {"application/pdf", "image/jpeg", "image/png", "image/webp", "application/msword",
           "application/vnd.openxmlformats-officedocument.wordprocessingml.document"}
AWARD_LEVELS = {"class": "Class", "school": "School", "state": "State", "national": "National", "international": "International"}


@router.get("/student-meta")
def meta(user: User = Depends(current_user)):
    return {"merits": {k: {"label": v[0], "points": v[1]} for k, v in MERITS.items()},
            "demerits": {k: {"label": v[0], "points": v[1]} for k, v in DEMERITS.items()},
            "documents": DOC_KINDS, "award_levels": AWARD_LEVELS}


# ---------- Access ----------

class Access:
    def __init__(self, full: bool, edit: bool, teacher: bool, health: bool, safe: bool, why: str):
        self.full, self.edit, self.teacher, self.health, self.safe, self.why = full, edit, teacher, health, safe, why

    @property
    def any(self) -> bool:
        return self.full or self.teacher

    def out(self) -> dict:
        return {"full": self.full, "edit": self.edit, "teacher": self.teacher, "health": self.health, "safeguarding": self.safe, "why": self.why}


def relation(db: Session, user: User, s: Student) -> str | None:
    """Why this member of staff is linked to the student, if they are."""
    if s.class_id:
        c = db.get(SchoolClass, s.class_id)
        if c and c.form_teacher_id == user.id:
            return "Form teacher"
        if db.scalar(select(ClassSubject.id).where(ClassSubject.class_id == s.class_id, ClassSubject.teacher_user_id == user.id)):
            return "Subject teacher"
    if db.scalar(select(StudentElective.id).join(TeachingGroup, TeachingGroup.id == StudentElective.group_id).where(
            StudentElective.student_id == s.id, TeachingGroup.teacher_user_id == user.id)):
        return "Subject teacher"
    if s.house_id:
        h = db.get(House, s.house_id)
        if h and h.master_user_id == user.id:
            return "House master"
    if s.boarding_status == BoardingStatus.boarder:
        bed = db.scalar(select(Bed).where(Bed.student_id == s.id))
        if bed:
            h = db.get(Hostel, bed.hostel_id)
            if h and h.house_parent_user_id == user.id:
                return "House parent"
        if any(m.role == Role.house_parent and m.school_id == s.school_id for m in user.memberships):
            return "House parent"
    if db.scalar(select(StudentClub.id).join(Club, Club.id == StudentClub.club_id).where(StudentClub.student_id == s.id, Club.patron_user_id == user.id)):
        return "Club patron"
    return None


def access_for(db: Session, user: User, s: Student) -> Access:
    school = db.get(School, s.school_id)
    full = rights.has(user, school, "students.see", db)
    edit = rights.has(user, school, "students.change", db) and not rights.acting(user)
    why = None if full else relation(db, user, s)
    from app.api.ops import desk_members
    nurse = user.id in desk_members(db, school.id, "sickbay") and not rights.acting(user)
    health = nurse or rights.has(user, school, "private.health", db) and not rights.acting(user)
    safe = rights.has(user, school, "private.safeguarding", db) and not rights.acting(user)
    return Access(full, edit, bool(why), health, safe, why or ("Students" if full else ""))


def get_student(db: Session, user: User, sid: uuid.UUID, write: bool = False) -> tuple[Student, Access]:
    s = db.get(Student, sid)
    if not s:
        raise not_found("Student")
    a = access_for(db, user, s)
    if not a.any:
        raise not_found("Student")
    if write and not a.edit:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You can look at this profile but not change it")
    return s, a


def name_of(db: Session, uid: uuid.UUID | None) -> str | None:
    u = db.get(User, uid) if uid else None
    return u.full_name if u else None


def masked(nin: str | None) -> str | None:
    return ("•" * max(0, len(nin) - 4) + nin[-4:]) if nin else None


# ---------- The profile ----------

def placement(db: Session, s: Student) -> dict:
    c = db.get(SchoolClass, s.class_id) if s.class_id else None
    house = db.get(House, s.house_id) if s.house_id else None
    bed = db.scalar(select(Bed).where(Bed.student_id == s.id))
    hostel = db.get(Hostel, bed.hostel_id) if bed else None
    room = db.get(HostelRoom, bed.room_id) if bed and bed.room_id else None
    from app.models import RouteRider
    rr = db.scalar(select(RouteRider).where(RouteRider.student_id == s.id))
    route = db.get(BusRoute, rr.route_id) if rr else None
    clubs = [{"id": str(cl.id), "name": cl.name, "role": sc.role, "patron": name_of(db, cl.patron_user_id)}
             for sc, cl in db.execute(select(StudentClub, Club).join(Club, Club.id == StudentClub.club_id).where(StudentClub.student_id == s.id).order_by(Club.name))]
    subjects = []
    if c:
        for cs, sub in db.execute(select(ClassSubject, Subject).join(Subject, Subject.id == ClassSubject.subject_id).where(ClassSubject.class_id == c.id).order_by(Subject.name)):
            subjects.append({"name": sub.name, "teacher": name_of(db, cs.teacher_user_id), "elective": False})
    for el, sub in db.execute(select(StudentElective, Subject).join(Subject, Subject.id == StudentElective.subject_id).where(StudentElective.student_id == s.id)):
        g = db.get(TeachingGroup, el.group_id) if el.group_id else None
        if not any(x["name"] == sub.name for x in subjects):
            subjects.append({"name": sub.name, "teacher": name_of(db, g.teacher_user_id) if g else None, "elective": True})
    return {"class": {"id": str(c.id), "name": c.name, "level": c.level, "form_teacher": name_of(db, c.form_teacher_id)} if c else None,
            "house": {"id": str(house.id), "name": house.name, "colour": house.colour, "master": name_of(db, house.master_user_id)} if house else None,
            "bed": {"hostel": hostel.name if hostel else None, "room": room.name if room else None, "bed": bed.label,
                    "house_parent": name_of(db, hostel.house_parent_user_id) if hostel else None} if bed else None,
            "bus": {"route": route.name, "stop": rr.stop} if route else None, "clubs": clubs, "subjects": subjects}


def attendance_summary(db: Session, s: Student) -> dict:
    today = now_wat().date()
    since = today - timedelta(days=90)
    rows = list(db.scalars(select(AttendanceRecord).where(AttendanceRecord.student_id == s.id, AttendanceRecord.on_date >= since).order_by(AttendanceRecord.on_date)))
    day = [r for r in rows if r.kind.value == "school"]
    def rate(rs):
        return round(100 * sum(1 for r in rs if r.status in (AttendanceStatus.present, AttendanceStatus.late)) / len(rs)) if rs else None
    last30 = [r for r in day if r.on_date >= today - timedelta(days=30)]
    prev30 = [r for r in day if today - timedelta(days=60) <= r.on_date < today - timedelta(days=30)]
    absences = [r for r in day if r.status == AttendanceStatus.absent]
    weekday = Counter(r.on_date.weekday() for r in absences)
    streak = 0
    for r in reversed(day):
        if r.status in (AttendanceStatus.present, AttendanceStatus.late):
            streak += 1
        else:
            break
    return {"rate_30": rate(last30), "rate_prev": rate(prev30), "rate_90": rate(day), "days": len(day), "absent": len(absences),
            "late": sum(1 for r in day if r.status == AttendanceStatus.late), "streak": streak,
            "worst_day": (["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"][weekday.most_common(1)[0][0]], weekday.most_common(1)[0][1]) if weekday else None,
            "calendar": [{"date": r.on_date.isoformat(), "status": r.status.value, "kind": r.kind.value} for r in rows if r.on_date >= today - timedelta(days=42)]}


def family(db: Session, s: Student, a: Access) -> dict:
    gs = []
    for g in sorted(s.guardians, key=lambda g: (not g.is_primary, g.created_at)):
        others = [{"id": str(o.id), "name": o.full_name, "class_name": o.school_class.name if o.school_class else None}
                  for o in db.scalars(select(Student).join(StudentGuardian, StudentGuardian.student_id == Student.id)
                                      .where(StudentGuardian.user_id == g.user_id, Student.id != s.id))]
        gs.append({"link_id": str(g.id), "user_id": str(g.user_id), "name": g.user.full_name, "relationship": g.relationship_label, "phone": g.user.phone,
                   "email": g.user.email if a.full else None, "is_primary": g.is_primary, "emergency": g.emergency, "can_pick_up": g.can_pick_up,
                   "lives_with": g.lives_with, "occupation": g.occupation if a.full else None, "address": g.address if a.full else None,
                   "has_login": bool(g.user.last_login_at), "other_children": others})
    contacts = [{"id": str(c.id), "name": c.name, "phone": c.phone, "relationship": c.relationship_label, "photo": c.photo, "note": c.note}
                for c in db.scalars(select(StudentContact).where(StudentContact.student_id == s.id).order_by(StudentContact.created_at))]
    return {"guardians": gs, "contacts": contacts}


def conduct(db: Session, s: Student) -> dict:
    rows = list(db.scalars(select(ConductEntry).where(ConductEntry.student_id == s.id).order_by(ConductEntry.created_at.desc()).limit(200)))
    since = datetime.now(timezone.utc) - timedelta(days=30)
    return {"total": sum(r.points for r in rows), "merits": sum(r.points for r in rows if r.points > 0), "demerits": sum(r.points for r in rows if r.points < 0),
            "last_30": sum(r.points for r in rows if r.created_at >= since), "demerits_30": sum(1 for r in rows if r.points < 0 and r.created_at >= since),
            "entries": [{"id": str(r.id), "kind": r.kind, "category": r.category,
                         "label": (MERITS.get(r.category) or DEMERITS.get(r.category) or (r.category,))[0], "points": r.points, "note": r.note,
                         "by": name_of(db, r.by_id), "by_id": str(r.by_id) if r.by_id else None, "at": r.created_at.isoformat()} for r in rows[:60]]}


def completeness(s: Student, fam: dict, docs: set[str], health: StudentHealth | None) -> dict:
    checks = [("Photo", bool(s.photo)), ("Date of birth", bool(s.date_of_birth)), ("State and LGA", bool(s.state_of_origin and s.lga)),
              ("Home address", bool(s.home_address)), ("Class", bool(s.class_id)), ("House", bool(s.house_id)),
              ("A parent with a phone number", any(g["phone"] for g in fam["guardians"])), ("Main contact chosen", any(g["is_primary"] for g in fam["guardians"])),
              ("Health record", bool(health)), ("Birth certificate", "birth_certificate" in docs), ("Passport photo", "passport_photo" in docs or bool(s.photo)),
              ("Date admitted", bool(s.admitted_on))]
    done = sum(1 for _, ok in checks if ok)
    return {"percent": round(100 * done / len(checks)), "missing": [n for n, ok in checks if not ok]}


@router.get("/students/{student_id}/profile")
def profile(student_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    s, a = get_student(db, user, student_id)
    school = db.get(School, s.school_id)
    today = now_wat().date()
    fam = family(db, s, a)
    place = placement(db, s)
    att = attendance_summary(db, s)
    health = db.scalar(select(StudentHealth).where(StudentHealth.student_id == s.id))
    from app.api.ops import desk_members
    if a.health and user.id not in desk_members(db, school.id, "sickbay"):
        rights.use_private(db, user, school, "health", s.full_name)
    if a.safe:
        rights.use_private(db, user, school, "safeguarding", s.full_name)
    visits = list(db.scalars(select(ClinicVisit).where(ClinicVisit.student_id == s.id).order_by(ClinicVisit.seen_at.desc()).limit(40)))
    incidents = [i for i in db.scalars(select(Incident).where(Incident.school_id == s.school_id).order_by(Incident.occurred_at.desc()).limit(800))
                 if str(s.id) in (i.student_ids or [])]
    passes = list(db.scalars(select(GatePass).where(GatePass.student_id == s.id).order_by(GatePass.leave_at.desc()).limit(20)))
    visitors = list(db.scalars(select(Visitor).where(Visitor.student_id == s.id).order_by(Visitor.time_in.desc()).limit(20)))
    loans = list(db.scalars(select(Loan).where(Loan.student_id == s.id).order_by(Loan.issued_at.desc()).limit(60)))
    books = {b.id: b for b in db.scalars(select(Book).where(Book.id.in_({l.book_id for l in loans} or {uuid.uuid4()})))}
    cond = conduct(db, s)
    awards = list(db.scalars(select(StudentAward).where(StudentAward.student_id == s.id).order_by(StudentAward.on_date.desc())))
    notes = [n for n in db.scalars(select(StudentNote).where(StudentNote.student_id == s.id).order_by(StudentNote.created_at.desc()).limit(80))
             if not n.private or a.safe]
    docs = list(db.scalars(select(StudentDocument).where(StudentDocument.student_id == s.id).order_by(StudentDocument.created_at.desc()))) if a.full else []
    events = list(db.scalars(select(StudentEvent).where(StudentEvent.student_id == s.id).order_by(StudentEvent.created_at.desc())))

    open_loans = [l for l in loans if not l.returned_at]
    out = {
        "access": a.out(),
        "student": {"id": str(s.id), "admission_no": s.admission_no, "first_name": s.first_name, "middle_name": s.middle_name, "last_name": s.last_name,
                    "full_name": s.full_name, "nickname": s.nickname, "gender": s.gender.value, "date_of_birth": s.date_of_birth.isoformat() if s.date_of_birth else None,
                    "age": (today.year - s.date_of_birth.year - ((today.month, today.day) < (s.date_of_birth.month, s.date_of_birth.day))) if s.date_of_birth else None,
                    "boarding_status": s.boarding_status.value, "status": s.status.value, "photo": s.photo, "leadership": s.leadership, "talents": s.talents or [],
                    "class_id": str(s.class_id) if s.class_id else None, "house_id": str(s.house_id) if s.house_id else None, "branch_id": str(s.branch_id),
                    "school_id": str(s.school_id), "school_name": school.name, "school_colour": school.colour,
                    "birthday_in": birthday_in(s.date_of_birth, today)},
        "personal": {k: getattr(s, k) for k in ("religion", "nationality", "state_of_origin", "lga", "home_town", "languages", "previous_school", "entry_class",
                                                "leave_reason", "next_school")}
                    | {"home_address": s.home_address if a.full else None, "nin": masked(s.nin) if a.full else None, "has_nin": bool(s.nin),
                       "admitted_on": s.admitted_on.isoformat() if s.admitted_on else None, "left_on": s.left_on.isoformat() if s.left_on else None,
                       "support_needs": s.support_needs if a.health else None, "has_support_needs": bool(s.support_needs)},
        "family": fam,
        "placement": place,
        "attendance": att,
        "health": {"allergies": health.allergies if health else None, "diet": health.diet if health else None,
                   "alert": bool(health and (health.allergies or health.conditions)),
                   "record": {k: getattr(health, k) for k in ("blood_group", "genotype", "conditions", "medications", "hospital")} if health and a.health else None,
                   "visits": [{"at": v.seen_at.isoformat(), "complaint": v.complaint, "outcome": v.outcome, "temperature": v.temperature} for v in visits] if a.health else None,
                   "visit_count_30": sum(1 for v in visits if v.seen_at >= datetime.now(timezone.utc) - timedelta(days=30)) if a.health else None},
        "incidents": [{"id": str(i.id), "number": i.number, "kind": i.kind, "severity": i.severity, "summary": i.summary, "status": i.status,
                       "at": i.occurred_at.isoformat()} for i in incidents] if a.safe else None,
        "incident_count": len(incidents) if a.safe else None,
        "passes": [{"kind": p.kind, "reason": p.reason, "status": p.status, "leave_at": p.leave_at.isoformat(), "return_by": p.return_by.isoformat() if p.return_by else None,
                    "escort": p.escort_name, "returned_at": p.returned_at.isoformat() if p.returned_at else None} for p in passes],
        "visitors": [{"name": v.name, "kind": v.kind, "purpose": v.purpose, "at": v.time_in.isoformat()} for v in visitors],
        "library": {"out": [{"title": books[l.book_id].title if l.book_id in books else "?", "due_on": l.due_on.isoformat(),
                             "late": max(0, (today - l.due_on).days)} for l in open_loans],
                    "total": len(loans), "this_term": sum(1 for l in loans if l.issued_at.date() >= today - timedelta(days=100)),
                    "recent": [{"title": books[l.book_id].title if l.book_id in books else "?", "at": l.issued_at.isoformat()} for l in loans[:8]]},
        "conduct": cond,
        "awards": [{"id": str(w.id), "title": w.title, "level": w.level, "on_date": w.on_date.isoformat(), "note": w.note, "by": name_of(db, w.by_id)} for w in awards],
        "notes": [{"id": str(n.id), "text": n.text, "private": n.private, "by": name_of(db, n.by_id), "by_id": str(n.by_id) if n.by_id else None,
                   "at": n.created_at.isoformat()} for n in notes],
        "documents": [{"id": str(d.id), "kind": d.kind, "label": DOC_KINDS.get(d.kind, d.kind), "filename": d.filename, "size": d.size,
                       "at": d.created_at.isoformat(), "by": name_of(db, d.uploaded_by_id)} for d in docs] if a.full else None,
    }
    from app.api.family import note_out
    from app.models import FamilyNote
    out["from_home"] = [note_out(db, n) for n in db.scalars(select(FamilyNote).where(FamilyNote.student_id == s.id).order_by(FamilyNote.created_at.desc()).limit(8))]
    out["completeness"] = completeness(s, fam, {d.kind for d in docs}, health) if a.full else None
    out["timeline"] = timeline(db, s, a, events, visits, incidents, passes, visitors, loans, books, cond, awards, notes)
    out["insights"] = insights(s, out, today)
    db.commit()
    return out


def birthday_in(dob: date | None, today: date) -> int | None:
    if not dob:
        return None
    try:
        nxt = dob.replace(year=today.year)
    except ValueError:
        nxt = date(today.year, 3, 1)
    if nxt < today:
        nxt = nxt.replace(year=today.year + 1) if not (nxt.month == 2 and nxt.day == 29) else date(today.year + 1, 3, 1)
    return (nxt - today).days


def timeline(db: Session, s: Student, a: Access, events, visits, incidents, passes, visitors, loans, books, cond, awards, notes) -> list[dict]:
    items: list[dict] = []
    add = lambda at, kind, icon, hue, title, detail="": items.append({"at": at if isinstance(at, str) else at.isoformat(), "kind": kind, "icon": icon, "hue": hue, "title": title, "detail": detail})
    for e in events:
        add(e.created_at, "event", {"admitted": "sparkle", "class": "classes", "boarding": "bed", "status": "flag", "family": "message"}.get(e.kind, "history"), "indigo", e.text, name_of(db, e.by_id) or "")
    if s.admitted_on and not any(e.kind == "admitted" for e in events):
        add(datetime.combine(s.admitted_on, datetime.min.time(), tzinfo=timezone.utc), "event", "sparkle", "indigo", f"Admitted{' into ' + s.entry_class if s.entry_class else ''}")
    if a.health:
        for v in visits:
            add(v.seen_at, "health", "stethoscope", "rose", f"Sick bay: {v.complaint}", {"class": "back to class", "rest": "rested", "sick_bay": "kept in", "home": "sent home", "hospital": "taken to hospital"}.get(v.outcome, v.outcome))
    if a.safe:
        for i in incidents:
            add(i.occurred_at, "incident", "flame", "red", f"Incident #{i.number}: {i.summary}", f"{i.severity} · {i.status}")
    for p in passes:
        add(p.leave_at, "pass", "log-out", "teal", f"Exit pass ({p.kind}): {p.reason}", p.status)
    for v in visitors:
        add(v.time_in, "visit", "shield", "violet", f"Visited by {v.name}", v.purpose)
    for l in loans[:30]:
        add(l.issued_at, "library", "book", "sky", f"Borrowed “{books[l.book_id].title if l.book_id in books else 'a book'}”",
            "returned" if l.returned_at else "still out")
    for c in cond["entries"][:40]:
        add(c["at"], "conduct", "star" if c["points"] > 0 else "thumbs-up", "green" if c["points"] > 0 else "orange",
            f"{'+' if c['points'] > 0 else ''}{c['points']} {c['label']}", " · ".join(x for x in (c["note"], c["by"]) if x))
    for w in awards:
        add(datetime.combine(w.on_date, datetime.min.time(), tzinfo=timezone.utc), "award", "trophy", "amber", f"Award: {w.title}", AWARD_LEVELS.get(w.level, w.level))
    for n in notes:
        add(n.created_at, "note", "lock" if n.private else "message", "slate", "Private note" if n.private else "Note", " · ".join(x for x in (n.text[:140], name_of(db, n.by_id)) if x))
    items.sort(key=lambda x: x["at"], reverse=True)
    return items[:150]


def insights(s: Student, p: dict, today: date) -> list[dict]:
    tips: list[dict] = []
    att = p["attendance"]
    first = s.nickname or s.first_name
    if att["rate_30"] is not None and att["rate_prev"] is not None and att["rate_30"] <= att["rate_prev"] - 10:
        tips.append({"kind": "alert", "icon": "attendance", "text": f"Attendance fell to {att['rate_30']}% this month (was {att['rate_prev']}%). Worth a call home."})
    elif att["rate_30"] is not None and att["rate_30"] < 85:
        tips.append({"kind": "alert", "icon": "attendance", "text": f"Attendance is {att['rate_30']}% this month."})
    if att["worst_day"] and att["worst_day"][1] >= 3:
        tips.append({"kind": "tip", "icon": "calendar", "text": f"Absent on {att['worst_day'][1]} {att['worst_day'][0]}s in the last 3 months. A pattern like this often has a reason at home."})
    if att["streak"] >= 20:
        tips.append({"kind": "strength", "icon": "flame", "text": f"{att['streak']} school days in a row without missing a day."})
    h = p["health"]
    if h.get("visit_count_30") and h["visit_count_30"] >= 3:
        tips.append({"kind": "alert", "icon": "stethoscope", "text": f"{h['visit_count_30']} sick bay visits in the last 30 days. Check with the nurse and the family."})
    lib = p["library"]
    late = [b for b in lib["out"] if b["late"]]
    if late:
        tips.append({"kind": "tip", "icon": "book", "text": f"Has {len(late)} overdue library book{'s' if len(late) > 1 else ''}: “{late[0]['title']}”."})
    if lib["this_term"] >= 5:
        tips.append({"kind": "strength", "icon": "book", "text": f"A keen reader: {lib['this_term']} books this term."})
    c = p["conduct"]
    if c["demerits_30"] >= 3:
        tips.append({"kind": "grow", "icon": "target", "text": f"{c['demerits_30']} demerits in 30 days. A short talk with the form teacher may help more than more points."})
    if c["last_30"] >= 10:
        tips.append({"kind": "strength", "icon": "star", "text": f"{c['last_30']} merit points this month."})
    fam = p["family"]
    if not any(g["phone"] for g in fam["guardians"]):
        tips.append({"kind": "alert", "icon": "phone", "text": "No parent phone number. The school can't reach the family in an emergency."})
    elif not any(g["can_pick_up"] for g in fam["guardians"]) and not fam["contacts"]:
        tips.append({"kind": "tip", "icon": "shield", "text": "Nobody is listed as allowed to collect this student."})
    if p["student"]["birthday_in"] is not None and p["student"]["birthday_in"] <= 7:
        d = p["student"]["birthday_in"]
        tips.append({"kind": "strength", "icon": "sparkle", "text": f"{first}'s birthday is {'today' if d == 0 else 'tomorrow' if d == 1 else f'in {d} days'}."})
    if p.get("completeness") and p["completeness"]["percent"] < 60:
        tips.append({"kind": "tip", "icon": "clipboard", "text": "The profile is only " + str(p["completeness"]["percent"]) + "% complete. Missing: " + ", ".join(p["completeness"]["missing"][:4]) + "."})
    return tips


# ---------- Changing the profile ----------

class PersonalIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    nickname: str | None = Field(default=None, max_length=60)
    religion: str | None = Field(default=None, max_length=30)
    nationality: str | None = Field(default=None, max_length=40)
    state_of_origin: str | None = Field(default=None, max_length=50)
    lga: str | None = Field(default=None, max_length=80)
    home_town: str | None = Field(default=None, max_length=80)
    home_address: str | None = Field(default=None, max_length=300)
    languages: str | None = Field(default=None, max_length=120)
    nin: str | None = Field(default=None, max_length=20)
    previous_school: str | None = Field(default=None, max_length=150)
    admitted_on: date | None = None
    entry_class: str | None = Field(default=None, max_length=40)
    house_id: uuid.UUID | None = None
    leadership: str | None = Field(default=None, max_length=60)
    talents: list[str] = Field(default_factory=list, max_length=15)
    leave_reason: str | None = Field(default=None, max_length=200)
    next_school: str | None = Field(default=None, max_length=150)


@router.put("/students/{student_id}/personal")
def save_personal(student_id: uuid.UUID, data: PersonalIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    s, a = get_student(db, user, student_id, write=True)
    body = data.model_dump()
    if body["nin"]:
        if body["nin"].startswith("•"):
            body.pop("nin")      # unchanged (masked value sent back)
        elif not re.fullmatch(r"\d{11}", body["nin"]):
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "The NIN has 11 digits")
    if body.get("house_id"):
        h = db.get(House, body["house_id"])
        if not h or h.school_id != s.school_id:
            raise not_found("House")
    if body.get("house_id") != s.house_id:
        h = db.get(House, body["house_id"]) if body.get("house_id") else None
        db.add(StudentEvent(student_id=s.id, kind="house", text=f"Joined {h.name}" if h else "Left their house", by_id=user.id))
    if body.get("leadership") != s.leadership and body.get("leadership"):
        db.add(StudentEvent(student_id=s.id, kind="leadership", text=f"Became {body['leadership']}", by_id=user.id))
    body["talents"] = [t.strip()[:40] for t in body["talents"] if t.strip()]
    for k, v in body.items():
        setattr(s, k, v or ([] if k == "talents" else None))
    db.commit()
    return profile(student_id, user, db)


class PhotoIn(BaseModel):
    photo: str | None = Field(default=None, max_length=400_000)
    thumb: str | None = Field(default=None, max_length=20_000)   # a tiny copy for lists


@router.put("/students/{student_id}/photo")
def save_photo(student_id: uuid.UUID, data: PhotoIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    s, _ = get_student(db, user, student_id, write=True)
    if data.photo and not data.photo.startswith("data:image/"):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Choose a photo")
    if data.thumb and not data.thumb.startswith("data:image/"):
        data.thumb = None
    s.photo = data.photo
    s.photo_thumb = data.thumb if data.photo else None
    db.commit()
    return {"photo": s.photo}


class SupportIn(BaseModel):
    support_needs: str | None = Field(default=None, max_length=3000)


@router.put("/students/{student_id}/support")
def save_support(student_id: uuid.UUID, data: SupportIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    s, a = get_student(db, user, student_id)
    if not a.health:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "private:health|Learning support notes are private. Ask the principal for access.")
    s.support_needs = (data.support_needs or "").strip() or None
    db.commit()
    return {"ok": True}


class GuardianFlags(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    relationship: str = Field(default="Parent", max_length=30)
    is_primary: bool = False
    emergency: bool = True
    can_pick_up: bool = True
    lives_with: bool = True
    occupation: str | None = Field(default=None, max_length=100)
    address: str | None = Field(default=None, max_length=300)


@router.put("/students/{student_id}/guardians/{link_id}")
def save_guardian(student_id: uuid.UUID, link_id: uuid.UUID, data: GuardianFlags, user: User = Depends(current_user), db: Session = Depends(get_db)):
    s, _ = get_student(db, user, student_id, write=True)
    g = next((x for x in s.guardians if x.id == link_id), None)
    if not g:
        raise not_found("Parent")
    if data.is_primary:
        for x in s.guardians:
            x.is_primary = False
    g.relationship_label, g.is_primary, g.emergency, g.can_pick_up, g.lives_with = data.relationship, data.is_primary, data.emergency, data.can_pick_up, data.lives_with
    g.occupation, g.address = data.occupation or None, data.address or None
    db.commit()
    return profile(student_id, user, db)


class ContactIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    name: str = Field(min_length=2, max_length=120)
    phone: str | None = Field(default=None, max_length=30)
    relationship: str = Field(default="Family friend", max_length=40)
    photo: str | None = Field(default=None, max_length=400_000)
    thumb: str | None = Field(default=None, max_length=20_000)   # a tiny copy for lists
    note: str | None = Field(default=None, max_length=200)


@router.post("/students/{student_id}/contacts", status_code=201)
def add_contact(student_id: uuid.UUID, data: ContactIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    s, _ = get_student(db, user, student_id, write=True)
    db.add(StudentContact(student_id=s.id, name=data.name, phone=data.phone, relationship_label=data.relationship, photo=data.photo, note=data.note))
    db.commit()
    return profile(student_id, user, db)


@router.delete("/students/{student_id}/contacts/{contact_id}")
def remove_contact(student_id: uuid.UUID, contact_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    s, _ = get_student(db, user, student_id, write=True)
    c = db.get(StudentContact, contact_id)
    if not c or c.student_id != s.id:
        raise not_found("Contact")
    db.delete(c)
    db.commit()
    return profile(student_id, user, db)


class ClubsIn(BaseModel):
    clubs: list[dict] = Field(max_length=20)   # [{club_id, role}]


@router.put("/students/{student_id}/clubs")
def save_clubs(student_id: uuid.UUID, data: ClubsIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    s, _ = get_student(db, user, student_id, write=True)
    valid = {c.id for c in db.scalars(select(Club).where(Club.school_id == s.school_id))}
    for old in db.scalars(select(StudentClub).where(StudentClub.student_id == s.id)):
        db.delete(old)
    db.flush()
    for c in data.clubs:
        cid = uuid.UUID(str(c.get("club_id")))
        if cid not in valid:
            raise not_found("Club")
        db.add(StudentClub(student_id=s.id, club_id=cid, role=str(c.get("role") or "Member")[:30]))
    db.commit()
    return profile(student_id, user, db)


# ---------- Merits, awards, notes ----------

class ConductIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    category: str
    note: str | None = Field(default=None, max_length=300)
    points: int | None = Field(default=None, ge=-10, le=10)


def may_give(a: Access) -> bool:
    return a.edit or a.teacher


@router.post("/students/{student_id}/conduct", status_code=201)
def give_conduct(student_id: uuid.UUID, data: ConductIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    s, a = get_student(db, user, student_id)
    if not may_give(a) or rights.acting(user):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the student's teachers and the school's leaders can do this")
    kind = "merit" if data.category in MERITS else "demerit" if data.category in DEMERITS else None
    if not kind:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Choose what it is for")
    base = (MERITS if kind == "merit" else DEMERITS)[data.category][1]
    pts = data.points if data.points is not None and (data.points > 0) == (base > 0) and data.points != 0 else base
    db.add(ConductEntry(school_id=s.school_id, student_id=s.id, house_id=s.house_id, kind=kind, category=data.category, points=pts, note=data.note, by_id=user.id))
    db.commit()
    return profile(student_id, user, db)


@router.delete("/conduct/{entry_id}")
def remove_conduct(entry_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    e = db.get(ConductEntry, entry_id)
    if not e:
        raise not_found("Entry")
    s, a = get_student(db, user, e.student_id)
    if not (a.edit or e.by_id == user.id) or rights.acting(user):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the person who gave it can take it back")
    db.delete(e)
    db.commit()
    return profile(s.id, user, db)


class AwardIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    title: str = Field(min_length=2, max_length=150)
    level: str = Field(default="school", pattern="^(class|school|state|national|international)$")
    on_date: date
    note: str | None = Field(default=None, max_length=300)


@router.post("/students/{student_id}/awards", status_code=201)
def add_award(student_id: uuid.UUID, data: AwardIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    s, a = get_student(db, user, student_id)
    if not may_give(a) or rights.acting(user):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the student's teachers and the school's leaders can do this")
    db.add(StudentAward(school_id=s.school_id, student_id=s.id, by_id=user.id, **data.model_dump()))
    db.commit()
    return profile(student_id, user, db)


@router.delete("/awards/{award_id}")
def remove_award(award_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    w = db.get(StudentAward, award_id)
    if not w:
        raise not_found("Award")
    s, a = get_student(db, user, w.student_id)
    if not (a.edit or w.by_id == user.id) or rights.acting(user):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the person who added it can remove it")
    db.delete(w)
    db.commit()
    return profile(s.id, user, db)


class NoteIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    text: str = Field(min_length=2, max_length=3000)
    private: bool = False


@router.post("/students/{student_id}/notes", status_code=201)
def add_note(student_id: uuid.UUID, data: NoteIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    s, a = get_student(db, user, student_id)
    if not may_give(a) or rights.acting(user):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the student's teachers and the school's leaders can add notes")
    if data.private and not a.safe:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only people with the safeguarding right can write private notes")
    db.add(StudentNote(school_id=s.school_id, student_id=s.id, text=data.text, private=data.private, by_id=user.id))
    if data.private:
        rights.notify_heads(db, db.get(School, s.school_id), f"{user.full_name} added a private note about {s.full_name}.", kind="private", icon="lock",
                            link=f"#/student/{s.id}", skip=user.id)
    db.commit()
    return profile(student_id, user, db)


@router.delete("/student-notes/{note_id}")
def remove_note(note_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    n = db.get(StudentNote, note_id)
    if not n:
        raise not_found("Note")
    s, a = get_student(db, user, n.student_id)
    if n.by_id != user.id or rights.acting(user):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the person who wrote a note can remove it")
    db.delete(n)
    db.commit()
    return profile(s.id, user, db)


# ---------- Documents ----------

MAX_DOC = 5 * 1024 * 1024


@router.post("/students/{student_id}/documents", status_code=201)
def upload(student_id: uuid.UUID, kind: str = Form(...), file: UploadFile = File(...), user: User = Depends(current_user), db: Session = Depends(get_db)):
    s, _ = get_student(db, user, student_id, write=True)
    if kind not in DOC_KINDS:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Choose what kind of document this is")
    data = file.file.read(MAX_DOC + 1)
    if len(data) > MAX_DOC:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "The file is bigger than 5 MB. Scan at a lower quality or save as PDF.")
    ctype = (file.content_type or "").split(";")[0]
    if ctype not in ALLOWED:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Upload a PDF, a photo (JPG or PNG) or a Word file")
    db.add(StudentDocument(school_id=s.school_id, student_id=s.id, kind=kind, filename=(file.filename or "document")[:200], content_type=ctype,
                           size=len(data), data=data, uploaded_by_id=user.id))
    db.commit()
    return profile(student_id, user, db)


@router.get("/students/{student_id}/documents/{doc_id}")
def download(student_id: uuid.UUID, doc_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    s, a = get_student(db, user, student_id)
    d = db.get(StudentDocument, doc_id)
    if not a.full or not d or d.student_id != s.id:
        raise not_found("Document")
    return Response(content=d.data, media_type=d.content_type, headers={"Content-Disposition": f'inline; filename="{d.filename}"'})


@router.delete("/students/{student_id}/documents/{doc_id}")
def delete_doc(student_id: uuid.UUID, doc_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    s, _ = get_student(db, user, student_id, write=True)
    d = db.get(StudentDocument, doc_id)
    if not d or d.student_id != s.id:
        raise not_found("Document")
    db.delete(d)
    db.commit()
    return profile(student_id, user, db)


# ---------- Houses ----------

@router.get("/schools/{school_id}/house-points")
def house_points(school_id: uuid.UUID, days: int = Query(90, ge=7, le=400), user: User = Depends(current_user), db: Session = Depends(get_db)):
    """The house league: merit points minus demerits, plus the top students."""
    school = db.get(School, school_id)
    if not school or not (rights.any_area(user, school) or user.id in set(db.scalars(select(Membership.user_id).where(Membership.school_id == school_id)))):
        raise not_found("School")
    since = datetime.now(timezone.utc) - timedelta(days=days)
    houses = list(db.scalars(select(House).where(House.school_id == school_id).order_by(House.name)))
    pts = defaultdict(int)
    for hid, p in db.execute(select(ConductEntry.house_id, func.sum(ConductEntry.points)).where(ConductEntry.school_id == school_id, ConductEntry.created_at >= since).group_by(ConductEntry.house_id)):
        pts[hid] = int(p or 0)
    sizes = Counter(db.scalars(select(Student.house_id).where(Student.school_id == school_id, Student.status == StudentStatus.active)))
    top = db.execute(select(ConductEntry.student_id, func.sum(ConductEntry.points).label("p")).where(ConductEntry.school_id == school_id, ConductEntry.created_at >= since)
                     .group_by(ConductEntry.student_id).order_by(func.sum(ConductEntry.points).desc()).limit(10)).all()
    return {"days": days, "houses": sorted([{"id": str(h.id), "name": h.name, "colour": h.colour, "points": pts[h.id], "students": sizes[h.id]} for h in houses], key=lambda x: -x["points"]),
            "no_house": sizes[None],
            "top": [{"id": str(sid), "name": db.get(Student, sid).full_name, "points": int(p), "class_name": db.get(Student, sid).school_class.name if db.get(Student, sid).school_class else None}
                    for sid, p in top if p and p > 0]}


class SpreadIn(BaseModel):
    only_without: bool = True


@router.post("/schools/{school_id}/houses/spread")
def spread(school_id: uuid.UUID, data: SpreadIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Share students across houses fairly: balanced by class, boys and girls, and keeping brothers and sisters together."""
    school = db.get(School, school_id)
    if not school or not rights.has(user, school, "students.change", db) or rights.acting(user):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only people who can change students can do this")
    houses = list(db.scalars(select(House).where(House.school_id == school_id).order_by(House.name)))
    if len(houses) < 2:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Add at least two houses first (Set-up → Houses and clubs)")
    studs = list(db.scalars(select(Student).where(Student.school_id == school_id, Student.status == StudentStatus.active)))
    count = Counter(s.house_id for s in studs if s.house_id)
    # Keep siblings together: a student whose brother or sister already has a house goes to that house.
    fam = defaultdict(set)
    for g in db.scalars(select(StudentGuardian).join(Student, Student.id == StudentGuardian.student_id).where(Student.school_id == school_id)):
        fam[g.user_id].add(g.student_id)
    by_id = {s.id: s for s in studs}
    sibling_house = {}
    for kids in fam.values():
        hs = [by_id[k].house_id for k in kids if k in by_id and by_id[k].house_id]
        for k in kids:
            if hs:
                sibling_house[k] = hs[0]
    todo = [s for s in studs if not s.house_id] if data.only_without else studs
    if not data.only_without:
        count = Counter()
    level_gender = Counter()
    for s in studs:
        if s.house_id and s not in todo:
            level_gender[(s.house_id, s.school_class.level if s.school_class else "", s.gender.value)] += 1
    todo.sort(key=lambda s: (s.school_class.level if s.school_class else "", s.gender.value, s.last_name))
    moved = 0
    for s in todo:
        lvl = s.school_class.level if s.school_class else ""
        hid = sibling_house.get(s.id) if data.only_without else None
        if not hid:
            hid = min(houses, key=lambda h: (level_gender[(h.id, lvl, s.gender.value)], count[h.id], h.name)).id
        if s.house_id != hid:
            s.house_id = hid
            moved += 1
        count[hid] += 1
        level_gender[(hid, lvl, s.gender.value)] += 1
        for k in [k for kids in fam.values() if s.id in kids for k in kids]:
            sibling_house.setdefault(k, hid)
    db.commit()
    return {"moved": moved, "houses": [{"name": h.name, "students": count[h.id]} for h in houses]}


# ---------- For the gate: who may collect this student ----------

@router.get("/students/{student_id}/collectors")
def collectors(student_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """The gate team and the student's teachers can check who is allowed to collect a student."""
    s = db.get(Student, student_id)
    if not s:
        raise not_found("Student")
    from app.api.ops import desk_members
    a = access_for(db, user, s)
    if not (a.any or user.id in desk_members(db, s.school_id, "gate")):
        raise not_found("Student")
    people = [{"name": g.user.full_name, "relationship": g.relationship_label, "phone": g.user.phone, "photo": None}
              for g in s.guardians if g.can_pick_up]
    people += [{"name": c.name, "relationship": c.relationship_label, "phone": c.phone, "photo": c.photo}
               for c in db.scalars(select(StudentContact).where(StudentContact.student_id == s.id))]
    return {"student": {"id": str(s.id), "name": s.full_name, "photo": s.photo}, "people": people}
