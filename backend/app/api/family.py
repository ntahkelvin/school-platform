"""Parents and students: their own portal, telling the school things, and the school giving them logins.

A parent sees their own children only; a student sees themselves. What they see is set per school (FamilySettings).
Private records (incidents, staff notes, documents, ID numbers) never reach this portal.
"""
import re
import secrets
import uuid
from collections import Counter
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.access import check, not_found
from app.api.academics import _level_order
from app.api.deps import current_user
from app.api.people import temporary_password
from app.api.staff_day import now_wat
from app.api.student360 import AWARD_LEVELS, attendance_summary, birthday_in, conduct, name_of, placement
from app.core import rights
from app.core.db import get_db
from app.core.security import hash_password
from app.models import (
    Bed, Book, ClinicVisit, ConductEntry, FamilyNote, FamilySettings, GatePass, Hostel, House, Loan, Membership, Notice, Role, School,
    SchoolClass, Student, StudentAward, StudentEvent, StudentGuardian, StudentHealth, User,
)
from app.models.attendance import AttendanceKind, AttendanceRecord
from app.models.people import BoardingStatus, StudentStatus

router = APIRouter(prefix="/api", tags=["family"])

NOTE_KINDS = {"away": "Will be away", "sick": "Unwell at home", "collect": "Someone else is collecting", "late": "Coming late", "other": "Something else"}
OUTCOMES = {"class": "went back to class", "rest": "rested in the sick bay", "sick_bay": "was kept in the sick bay", "home": "was sent home", "hospital": "was taken to hospital"}


def settings_for(db: Session, school_id: uuid.UUID) -> FamilySettings:
    st = db.scalar(select(FamilySettings).where(FamilySettings.school_id == school_id))
    if not st:
        st = FamilySettings(school_id=school_id, student_logins=True, student_from_level="JSS 1", parents_see_sickbay=True, parents_see_conduct=True)
        db.add(st)
        db.flush()
    return st


def my_children(db: Session, user: User) -> list[Student]:
    """The students this login may see: their own children, or themselves."""
    kids = list(db.scalars(select(Student).join(StudentGuardian, StudentGuardian.student_id == Student.id)
                           .where(StudentGuardian.user_id == user.id).order_by(Student.date_of_birth.desc().nulls_last(), Student.first_name)))
    me = list(db.scalars(select(Student).where(Student.user_id == user.id)))
    return [s for s in me + kids if s.status == StudentStatus.active or s.left_on and s.left_on >= now_wat().date() - timedelta(days=60)]


def child_for(db: Session, user: User, sid: uuid.UUID) -> tuple[Student, str]:
    s = db.get(Student, sid)
    if not s:
        raise not_found("Student")
    if s.user_id == user.id:
        return s, "self"
    if db.scalar(select(StudentGuardian.id).where(StudentGuardian.student_id == sid, StudentGuardian.user_id == user.id)):
        return s, "parent"
    raise not_found("Student")


def today_status(db: Session, s: Student, today: date) -> dict:
    rec = db.scalar(select(AttendanceRecord).where(AttendanceRecord.student_id == s.id, AttendanceRecord.on_date == today, AttendanceRecord.kind == AttendanceKind.school))
    visit = db.scalar(select(ClinicVisit).where(ClinicVisit.student_id == s.id, ClinicVisit.seen_at >= datetime.combine(today, datetime.min.time(), tzinfo=timezone(timedelta(hours=1)))))
    out = db.scalar(select(GatePass).where(GatePass.student_id == s.id, GatePass.status == "out"))
    if out:
        return {"key": "out", "text": f"Out of school on a pass ({out.reason[:40]})", "hue": "teal"}
    if visit and visit.outcome in ("sick_bay", "home", "hospital") and not visit.discharged_at:
        return {"key": "sick", "text": "Seen at the sick bay today", "hue": "rose"}
    if not rec:
        return {"key": "none", "text": "Register not taken yet today" if today.weekday() < 5 else "No school today", "hue": "slate"}
    return {"present": {"key": "present", "text": "In school today", "hue": "green"}, "late": {"key": "late", "text": "In school today (arrived late)", "hue": "amber"},
            "absent": {"key": "absent", "text": "Marked absent today", "hue": "red"}, "excused": {"key": "excused", "text": "Excused today", "hue": "sky"}}.get(
        rec.status.value, {"key": rec.status.value, "text": rec.status.value, "hue": "slate"})


def school_card(school: School, st: FamilySettings) -> dict:
    return {"id": str(school.id), "name": school.name, "logo": school.logo, "colour": school.colour, "motto": school.motto, "phone": school.phone,
            "email": school.email, "address": school.address, "welcome": st.welcome}


# ---------- The portal ----------

@router.get("/me/family")
def my_family(user: User = Depends(current_user), db: Session = Depends(get_db)):
    kids = my_children(db, user)
    today = now_wat().date()
    schools, cards = {}, []
    for s in kids:
        if s.school_id not in schools:
            sc = db.get(School, s.school_id)
            schools[s.school_id] = school_card(sc, settings_for(db, s.school_id))
        house = db.get(House, s.house_id) if s.house_id else None
        att = attendance_summary(db, s)
        pts = db.scalar(select(func.sum(ConductEntry.points)).where(ConductEntry.student_id == s.id,
                        ConductEntry.created_at >= datetime.now(timezone.utc) - timedelta(days=30))) or 0
        late = db.scalar(select(func.count()).select_from(Loan).where(Loan.student_id == s.id, Loan.returned_at.is_(None), Loan.due_on < today)) or 0
        award = db.scalar(select(StudentAward).where(StudentAward.student_id == s.id).order_by(StudentAward.on_date.desc()))
        cards.append({"id": str(s.id), "first_name": s.first_name, "name": s.full_name, "nickname": s.nickname, "photo": s.photo_thumb or s.photo,
                      "gender": s.gender.value, "class_name": s.school_class.name if s.school_class else None, "school_id": str(s.school_id),
                      "house": house.name if house else None, "house_colour": house.colour if house else None, "boarder": s.boarding_status == BoardingStatus.boarder,
                      "is_me": s.user_id == user.id, "status": s.status.value, "today": today_status(db, s, today), "attendance": att["rate_30"],
                      "points_30": int(pts), "late_books": late, "latest_award": award.title if award else None, "birthday_in": birthday_in(s.date_of_birth, today)})
    notes = [note_out(db, n) for n in db.scalars(select(FamilyNote).where(FamilyNote.by_id == user.id).order_by(FamilyNote.created_at.desc()).limit(8))]
    db.commit()
    return {"name": user.full_name, "is_student": any(c["is_me"] for c in cards), "children": cards, "schools": list(schools.values()),
            "notes": notes, "note_kinds": NOTE_KINDS}


def note_out(db: Session, n: FamilyNote) -> dict:
    s = db.get(Student, n.student_id)
    return {"id": str(n.id), "student_id": str(n.student_id), "student": s.full_name if s else "?", "class_name": s.school_class.name if s and s.school_class else None,
            "kind": n.kind, "kind_label": NOTE_KINDS.get(n.kind, n.kind), "from_date": n.from_date.isoformat(), "to_date": n.to_date.isoformat() if n.to_date else None,
            "text": n.text, "collector": n.collector, "collector_phone": n.collector_phone, "by": name_of(db, n.by_id), "at": n.created_at.isoformat(),
            "seen_by": name_of(db, n.seen_by_id), "seen_at": n.seen_at.isoformat() if n.seen_at else None, "reply": n.reply}


@router.get("/me/children/{student_id}")
def child(student_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    s, how = child_for(db, user, student_id)
    school = db.get(School, s.school_id)
    st = settings_for(db, s.school_id)
    today = now_wat().date()
    place = placement(db, s)
    # Parents see the people looking after their child, not the hostel's internal details.
    if place["bed"]:
        place["bed"] = {"hostel": place["bed"]["hostel"], "house_parent": place["bed"]["house_parent"]}
    att = attendance_summary(db, s)
    cond = conduct(db, s) if st.parents_see_conduct else None
    if cond:
        for e in cond["entries"]:
            e.pop("by_id", None)
    health = db.scalar(select(StudentHealth).where(StudentHealth.student_id == s.id))
    visits = list(db.scalars(select(ClinicVisit).where(ClinicVisit.student_id == s.id).order_by(ClinicVisit.seen_at.desc()).limit(20))) if st.parents_see_sickbay else []
    loans = list(db.scalars(select(Loan).where(Loan.student_id == s.id).order_by(Loan.issued_at.desc()).limit(40)))
    books = {b.id: b for b in db.scalars(select(Book).where(Book.id.in_({l.book_id for l in loans} or {uuid.uuid4()})))}
    awards = list(db.scalars(select(StudentAward).where(StudentAward.student_id == s.id).order_by(StudentAward.on_date.desc())))
    passes = list(db.scalars(select(GatePass).where(GatePass.student_id == s.id).order_by(GatePass.leave_at.desc()).limit(10)))
    house_table = []
    if s.house_id:
        since = datetime.now(timezone.utc) - timedelta(days=90)
        pts = dict(db.execute(select(Student.house_id, func.sum(ConductEntry.points)).join(ConductEntry, ConductEntry.student_id == Student.id)
                              .where(Student.school_id == s.school_id, Student.house_id.is_not(None), ConductEntry.created_at >= since).group_by(Student.house_id)).all())
        house_table = sorted([{"name": h.name, "colour": h.colour, "points": int(pts.get(h.id) or 0), "mine": h.id == s.house_id}
                              for h in db.scalars(select(House).where(House.school_id == s.school_id))], key=lambda x: -x["points"])
    notes = [note_out(db, n) for n in db.scalars(select(FamilyNote).where(FamilyNote.student_id == s.id).order_by(FamilyNote.created_at.desc()).limit(10))]
    events = list(db.scalars(select(StudentEvent).where(StudentEvent.student_id == s.id, StudentEvent.kind != "family").order_by(StudentEvent.created_at.desc()).limit(20)))
    guardians = [{"name": g.user.full_name, "relationship": g.relationship_label, "phone": g.user.phone, "can_pick_up": g.can_pick_up, "is_me": g.user_id == user.id}
                 for g in sorted(s.guardians, key=lambda g: not g.is_primary)]
    open_pass = next((p for p in passes if p.status in ("requested", "approved", "out")), None)
    out = {
        "how": how,
        "school": school_card(school, st),
        "settings": {"sickbay": st.parents_see_sickbay, "conduct": st.parents_see_conduct},
        "student": {"id": str(s.id), "full_name": s.full_name, "first_name": s.first_name, "nickname": s.nickname, "admission_no": s.admission_no,
                    "gender": s.gender.value, "photo": s.photo, "boarder": s.boarding_status == BoardingStatus.boarder, "leadership": s.leadership,
                    "talents": s.talents or [], "status": s.status.value, "date_of_birth": s.date_of_birth.isoformat() if s.date_of_birth else None,
                    "birthday_in": birthday_in(s.date_of_birth, today)},
        "today": today_status(db, s, today),
        "placement": place,
        "attendance": att,
        "conduct": cond,
        "awards": [{"title": w.title, "level": AWARD_LEVELS.get(w.level, w.level), "on_date": w.on_date.isoformat(), "note": w.note} for w in awards],
        "health": {"allergies": health.allergies if health else None, "diet": health.diet if health else None,
                   "blood_group": health.blood_group if health else None, "genotype": health.genotype if health else None,
                   "visits": [{"at": v.seen_at.isoformat(), "complaint": v.complaint, "outcome": OUTCOMES.get(v.outcome, v.outcome),
                               "temperature": v.temperature, "parent_informed": v.parent_informed} for v in visits] if st.parents_see_sickbay else None},
        "library": {"out": [{"title": books[l.book_id].title if l.book_id in books else "?", "due_on": l.due_on.isoformat(), "late": max(0, (today - l.due_on).days)}
                            for l in loans if not l.returned_at],
                    "read": [{"title": books[l.book_id].title if l.book_id in books else "?", "author": books[l.book_id].author if l.book_id in books else None,
                              "at": l.issued_at.isoformat()} for l in loans[:12]],
                    "this_term": sum(1 for l in loans if l.issued_at.date() >= today - timedelta(days=100))},
        "passes": [{"code": p.code if p.status in ("approved", "out") else None, "reason": p.reason, "status": p.status, "leave_at": p.leave_at.isoformat(),
                    "return_by": p.return_by.isoformat() if p.return_by else None, "escort": p.escort_name} for p in passes],
        "open_pass": bool(open_pass),
        "houses": house_table,
        "family": guardians,
        "notes": notes,
        "journey": [{"at": e.created_at.isoformat(), "text": e.text} for e in events],
        "note_kinds": NOTE_KINDS,
    }
    from app.api.timetable import child_timetable
    out["timetable"] = child_timetable(db, s)
    out["highlights"] = highlights(s, out, how)
    db.commit()
    return out


def highlights(s: Student, p: dict, how: str) -> list[dict]:
    """Friendly lines for the family, good news first."""
    first = s.nickname or s.first_name
    you = how == "self"
    who = "You" if you else first
    tips = []
    att = p["attendance"]
    if att["streak"] >= 10:
        tips.append({"kind": "strength", "icon": "flame", "text": f"{who} {'have' if you else 'has'} been in school {att['streak']} days in a row. Brilliant!"})
    if att["rate_30"] is not None:
        if att["rate_30"] >= 95:
            tips.append({"kind": "strength", "icon": "attendance", "text": f"Attendance this month: {att['rate_30']}%. Excellent."})
        elif att["rate_30"] < 85:
            tips.append({"kind": "alert", "icon": "attendance", "text": f"Attendance this month is {att['rate_30']}%. Every day counts; talk to the form teacher if something is wrong."})
    if p["conduct"] and p["conduct"]["last_30"] >= 5:
        tips.append({"kind": "strength", "icon": "star", "text": f"{who} earned {p['conduct']['last_30']} merit points this month."})
    if p["conduct"] and p["conduct"]["demerits_30"] >= 3:
        tips.append({"kind": "grow", "icon": "target", "text": f"{p['conduct']['demerits_30']} demerits this month. A chat at home can help."})
    if p["awards"]:
        tips.append({"kind": "strength", "icon": "trophy", "text": f"Latest award: {p['awards'][0]['title']}."})
    late = [b for b in p["library"]["out"] if b["late"]]
    if late:
        tips.append({"kind": "tip", "icon": "book", "text": f"“{late[0]['title']}” is {late[0]['late']} day{'s' if late[0]['late'] > 1 else ''} late back to the library."})
    elif p["library"]["this_term"] >= 3:
        tips.append({"kind": "strength", "icon": "book", "text": f"{p['library']['this_term']} library books this term. A keen reader!"})
    mine = next((h for h in p["houses"] if h["mine"]), None)
    if mine and p["houses"] and p["houses"][0]["mine"]:
        tips.append({"kind": "strength", "icon": "trophy", "text": f"{mine['name']} is top of the house league!"})
    d = p["student"]["birthday_in"]
    if d is not None and d <= 7:
        tips.append({"kind": "strength", "icon": "sparkle", "text": ("Happy birthday! 🎂" if you else f"Happy birthday to {first}! 🎂") if d == 0 else f"Birthday in {d} day{'s' if d > 1 else ''}."})
    return tips


# ---------- Telling the school ----------

class NoteIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    kind: str = Field(pattern="^(away|sick|collect|late|other)$")
    from_date: date
    to_date: date | None = None
    text: str = Field(min_length=3, max_length=600)
    collector: str | None = Field(default=None, max_length=120)
    collector_phone: str | None = Field(default=None, max_length=32)


@router.post("/me/children/{student_id}/notes", status_code=201)
def tell_school(student_id: uuid.UUID, data: NoteIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    s, how = child_for(db, user, student_id)
    if how != "parent":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only a parent or guardian can send this")
    if rights.acting(user):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Nothing can be changed while seeing as someone else")
    today = now_wat().date()
    if data.from_date < today - timedelta(days=7) or data.from_date > today + timedelta(days=60):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Choose a date in the next two months")
    if data.to_date and data.to_date < data.from_date:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "The last day is before the first day")
    if data.kind == "collect" and not data.collector:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Say who is collecting")
    n = FamilyNote(school_id=s.school_id, student_id=s.id, by_id=user.id, **data.model_dump())
    db.add(n)
    db.flush()
    who = staff_for(db, s, data.kind)
    text = f"{user.full_name}: {s.full_name} – {NOTE_KINDS[data.kind].lower()}" + (f" ({data.collector})" if data.collector else "") + f". “{data.text[:120]}”"
    for uid in who:
        db.add(Notice(user_id=uid, school_id=s.school_id, kind="info", icon="message", text=text[:400], link=f"#/student/{s.id}"))
    db.add(StudentEvent(student_id=s.id, kind="family", text=f"Message from {user.full_name}: {NOTE_KINDS[data.kind]}", by_id=user.id))
    db.commit()
    return note_out(db, n)


def staff_for(db: Session, s: Student, kind: str) -> set[uuid.UUID]:
    """Who should hear about a parent's message: the form teacher, the house parent for boarders, the gate for collections."""
    ids: set[uuid.UUID] = set()
    c = db.get(SchoolClass, s.class_id) if s.class_id else None
    if c and c.form_teacher_id:
        ids.add(c.form_teacher_id)
    if s.boarding_status == BoardingStatus.boarder:
        bed = db.scalar(select(Bed).where(Bed.student_id == s.id))
        h = db.get(Hostel, bed.hostel_id) if bed else None
        if h and h.house_parent_user_id:
            ids.add(h.house_parent_user_id)
    if kind == "collect":
        from app.api.ops import desk_members
        ids |= desk_members(db, s.school_id, "gate")
    if not ids:
        ids = rights.school_roles_users(db, s.school_id, {"head", "vice_principal"})
    return ids


class ExeatIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    reason: str = Field(min_length=3, max_length=300)
    leave_at: datetime
    return_by: datetime
    escort_name: str = Field(min_length=2, max_length=120)
    escort_phone: str | None = Field(default=None, max_length=30)
    escort_relation: str | None = Field(default=None, max_length=40)


@router.post("/me/children/{student_id}/exeat", status_code=201)
def ask_exeat(student_id: uuid.UUID, data: ExeatIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """A parent asks for their boarder to come home; the house parent or principal approves it as usual."""
    s, how = child_for(db, user, student_id)
    if how != "parent" or rights.acting(user):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only a parent or guardian can ask for this")
    if s.boarding_status != BoardingStatus.boarder:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Day students go home every day")
    if data.return_by <= data.leave_at:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Return time must be after leaving time")
    if data.leave_at < datetime.now(timezone.utc) - timedelta(hours=2):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Choose a time from now on")
    if db.scalar(select(GatePass.id).where(GatePass.student_id == s.id, GatePass.status.in_(["requested", "approved", "out"]))):
        raise HTTPException(status.HTTP_409_CONFLICT, "There is already an exit pass waiting for this child")
    p = GatePass(school_id=s.school_id, student_id=s.id, code=secrets.token_hex(3).upper(), kind="home", reason=f"Asked by parent: {data.reason}",
                 leave_at=data.leave_at, return_by=data.return_by, escort_name=data.escort_name, escort_phone=data.escort_phone,
                 escort_relation=data.escort_relation, requested_by_id=user.id, status="requested")
    db.add(p)
    for uid in staff_for(db, s, "away") | rights.school_roles_users(db, s.school_id, {"house_parent"}):
        db.add(Notice(user_id=uid, school_id=s.school_id, kind="request", icon="log-out",
                      text=f"{user.full_name} asks for {s.full_name} to go home on {data.leave_at.astimezone(timezone(timedelta(hours=1))):%a %d %b, %H:%M}. Approve it in Operations → Exit passes.",
                      link=f"#/student/{s.id}"))
    db.commit()
    return {"status": p.status}


# ---------- The school's side ----------

def need_school(db: Session, user: User, school_id: uuid.UUID, area: str) -> School:
    s = db.get(School, school_id)
    if not s:
        raise not_found("School")
    check(user, s, area)
    return s


@router.get("/schools/{school_id}/family-notes")
def school_notes(school_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    need_school(db, user, school_id, "students")
    since = now_wat().date() - timedelta(days=14)
    rows = list(db.scalars(select(FamilyNote).where(FamilyNote.school_id == school_id, (FamilyNote.created_at >= datetime.combine(since, datetime.min.time(), tzinfo=timezone.utc))
                                                     | FamilyNote.seen_at.is_(None)).order_by(FamilyNote.created_at.desc()).limit(200)))
    return [note_out(db, n) for n in rows]


class SeenIn(BaseModel):
    reply: str | None = Field(default=None, max_length=400)


@router.put("/family-notes/{note_id}/seen")
def mark_seen(note_id: uuid.UUID, data: SeenIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    n = db.get(FamilyNote, note_id)
    if not n:
        raise not_found("Message")
    s = db.get(Student, n.student_id)
    school = db.get(School, n.school_id)
    if not (rights.has(user, school, "students.see", db) or user.id in staff_for(db, s, n.kind)) or rights.acting(user):
        raise not_found("Message")
    n.seen_by_id, n.seen_at = user.id, datetime.now(timezone.utc)
    if data.reply:
        n.reply = data.reply.strip()
    if n.by_id:
        db.add(Notice(user_id=n.by_id, school_id=n.school_id, kind="info", icon="check",
                      text=f"{user.full_name} has seen your message about {s.first_name}." + (f" “{n.reply}”" if n.reply else "")))
    db.commit()
    return note_out(db, n)


# ---------- Logins for parents and students ----------

class SettingsIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    student_logins: bool
    student_from_level: str = Field(max_length=20)
    parents_see_sickbay: bool
    parents_see_conduct: bool
    welcome: str | None = Field(default=None, max_length=600)


def family_summary(db: Session, school: School) -> dict:
    st = settings_for(db, school.id)
    studs = list(db.scalars(select(Student).where(Student.school_id == school.id, Student.status == StudentStatus.active)))
    ids = [s.id for s in studs] or [uuid.uuid4()]
    links = list(db.scalars(select(StudentGuardian).where(StudentGuardian.student_id.in_(ids))))
    parents = {g.user_id: g.user for g in links}
    kids_with_login_parent = {g.student_id for g in links if g.user.last_login_at}
    classes = {c.id: c for c in db.scalars(select(SchoolClass).where(SchoolClass.id.in_({s.class_id for s in studs if s.class_id} or {uuid.uuid4()})))}
    eligible = [s for s in studs if s.class_id in classes and _level_order(classes[s.class_id].level) >= _level_order(st.student_from_level)]
    users = {u.id: u for u in db.scalars(select(User).where(User.id.in_({s.user_id for s in studs if s.user_id} or {uuid.uuid4()})))}
    per_class = []
    for c in sorted(classes.values(), key=lambda c: (c.level_order, c.arm)):
        cs = [s for s in studs if s.class_id == c.id]
        per_class.append({"class_id": str(c.id), "name": c.name, "students": len(cs), "families_in": sum(1 for s in cs if s.id in kids_with_login_parent),
                          "student_logins": sum(1 for s in cs if s.user_id in users), "students_in": sum(1 for s in cs if s.user_id in users and users[s.user_id].last_login_at),
                          "eligible": _level_order(c.level) >= _level_order(st.student_from_level)})
    return {"settings": {"student_logins": st.student_logins, "student_from_level": st.student_from_level, "parents_see_sickbay": st.parents_see_sickbay,
                         "parents_see_conduct": st.parents_see_conduct, "welcome": st.welcome},
            "parents": len(parents), "parents_in": sum(1 for u in parents.values() if u.last_login_at),
            "students": len(studs), "no_parent": sum(1 for s in studs if not any(g.student_id == s.id for g in links)),
            "eligible": len(eligible), "student_logins": sum(1 for s in eligible if s.user_id in users),
            "students_in": sum(1 for s in eligible if s.user_id in users and users[s.user_id].last_login_at),
            "messages_new": db.scalar(select(func.count()).select_from(FamilyNote).where(FamilyNote.school_id == school.id, FamilyNote.seen_at.is_(None))) or 0,
            "classes": per_class}


@router.get("/schools/{school_id}/family-logins")
def logins_summary(school_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    school = need_school(db, user, school_id, "logins")
    out = family_summary(db, school)
    db.commit()
    return out


@router.put("/schools/{school_id}/family-settings")
def save_settings(school_id: uuid.UUID, data: SettingsIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    school = need_school(db, user, school_id, "logins")
    st = settings_for(db, school_id)
    for k, v in data.model_dump().items():
        setattr(st, k, v)
    if not data.student_logins:
        # Switching student logins off stops them working (they come back if switched on again).
        for u in db.scalars(select(User).join(Student, Student.user_id == User.id).where(Student.school_id == school_id)):
            u.is_active = False
    db.commit()
    return family_summary(db, school)


class SlipsIn(BaseModel):
    who: str = Field(pattern="^(parents|students)$")
    class_id: uuid.UUID | None = None
    only_new: bool = True


def username_for(db: Session, s: Student, school: School) -> str:
    base = re.sub(r"[^a-z0-9/._-]", "", s.admission_no.lower().replace(" ", ""))[:50] or s.first_name.lower()
    name = base
    n = 2
    while True:
        u = db.scalar(select(User).where(User.username == name))
        if not u or u.id == s.user_id:
            return name
        name = f"{base}-{n}"
        n += 1


@router.post("/schools/{school_id}/family-logins")
def make_slips(school_id: uuid.UUID, data: SlipsIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Login slips to send home. New passwords are made only for people who have never logged in (unless asked)."""
    school = need_school(db, user, school_id, "logins")
    if rights.acting(user):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Nothing can be changed while seeing as someone else")
    st = settings_for(db, school_id)
    q = select(Student).where(Student.school_id == school_id, Student.status == StudentStatus.active)
    if data.class_id:
        q = q.where(Student.class_id == data.class_id)
    studs = list(db.scalars(q.order_by(Student.class_id, Student.last_name, Student.first_name)))
    slips, skipped = [], Counter()
    if data.who == "parents":
        done: dict[uuid.UUID, dict] = {}
        staff_roles = {Role.owner, Role.head_of_school, Role.head, Role.vice_principal, Role.it_admin, Role.bursar, Role.teacher, Role.house_parent, Role.support}
        for s in studs:
            for g in sorted(s.guardians, key=lambda g: not g.is_primary):
                u = g.user
                if u.id in done:
                    done[u.id]["children"].append(f"{s.first_name} ({s.school_class.name if s.school_class else 'no class'})")
                    continue
                if any(m.role in staff_roles for m in u.memberships):
                    skipped["also staff (they use their staff login)"] += 1
                    continue
                if data.only_new and u.last_login_at:
                    skipped["already logged in"] += 1
                    continue
                if not (u.phone or u.email):
                    skipped["no phone number"] += 1
                    continue
                pw = temporary_password()
                u.password_hash, u.must_change_password, u.is_active = hash_password(pw), True, True
                done[u.id] = {"kind": "parent", "name": u.full_name, "username": u.phone or u.email, "password": pw,
                              "children": [f"{s.first_name} ({s.school_class.name if s.school_class else 'no class'})"], "class_name": s.school_class.name if s.school_class else None}
        slips = list(done.values())
    else:
        if not st.student_logins:
            raise HTTPException(status.HTTP_409_CONFLICT, "Student logins are switched off for this school. Switch them on first.")
        for s in studs:
            c = s.school_class
            if not c or _level_order(c.level) < _level_order(st.student_from_level):
                skipped[f"below {st.student_from_level}"] += 1
                continue
            u = db.get(User, s.user_id) if s.user_id else None
            if u and data.only_new and u.last_login_at:
                skipped["already logged in"] += 1
                continue
            pw = temporary_password()
            if not u:
                u = User(full_name=s.full_name, username=username_for(db, s, school), password_hash=hash_password(pw), must_change_password=True)
                db.add(u)
                db.flush()
                s.user_id = u.id
                db.add(Membership(user_id=u.id, role=Role.student, group_id=school.group_id, school_id=school.id, branch_id=s.branch_id))
            else:
                u.password_hash, u.must_change_password, u.is_active = hash_password(pw), True, True
                if not u.username:
                    u.username = username_for(db, s, school)
            slips.append({"kind": "student", "name": s.full_name, "username": u.username, "password": pw, "children": [], "class_name": c.name})
    db.commit()
    return {"school": school_card(school, st), "slips": slips, "skipped": [{"why": k, "count": v} for k, v in skipped.items()]}


def student_login_active(db: Session, s: Student, active: bool) -> None:
    """Students who leave lose their login; it comes back if they return."""
    if s.user_id:
        u = db.get(User, s.user_id)
        if u:
            u.is_active = active
