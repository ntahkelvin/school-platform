"""School operations, run mostly by non-teaching staff.

- Helpdesk: anyone reports a problem or asks for something; it goes to the right desk (maintenance, IT,
  store, transport, gate) and is tracked until it is fixed and the person who asked rates it.
- Gate: the visitors' book and students' exit passes (asked for, approved, checked out and back in).
- Incidents: accidents, fights, theft, damage, security scares, recorded and followed up.
- Sick bay: visits, treatment, medicines given (from the sick bay stock), students kept in, health notes.

Desks are teams. The principal, vice principals and IT team ("run the school") can see and do everything.
"""
import re
import secrets
import uuid
from collections import Counter
from datetime import date, datetime, time, timedelta, timezone
from statistics import mean

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.api.access import not_found
from app.core import rights
from app.api.deps import current_user
from app.api.staff_day import WAT, now_wat, runs, school_for, staff_ids
from app.core.db import get_db
from app.models import (
    ClinicVisit, DeskMember, Facility, GatePass, Incident, Membership, MedicineStock, Role, School, SchoolClass, StaffProfile,
    Student, StudentGuardian, StudentHealth, Ticket, User, Visitor,
)
from app.models.people import StudentStatus

router = APIRouter(prefix="/api", tags=["operations"])

DESKS = {
    "maintenance": {"label": "Maintenance and cleaning", "icon": "wrench", "hue": "orange",
                    "words": ["electric", "plumb", "carpent", "cleaner", "maintenance", "works", "handyman", "gardener", "mason", "welder", "painter"]},
    "it": {"label": "IT support", "icon": "laptop", "hue": "blue", "words": ["ict", "computer", "it officer", "it support", "network"]},
    "store": {"label": "Store", "icon": "store", "hue": "amber", "words": ["store", "procurement", "supplies"]},
    "transport": {"label": "Transport", "icon": "bus", "hue": "teal", "words": ["driver", "transport", "bus attendant"]},
    "gate": {"label": "Gate and security", "icon": "shield", "hue": "indigo", "words": ["security", "gate", "porter", "guard"]},
    "sickbay": {"label": "Sick bay", "icon": "stethoscope", "hue": "rose", "words": ["nurse", "matron", "health", "clinic", "doctor"]},
    "library": {"label": "Library", "icon": "book", "hue": "sky", "words": ["librar"]},
    "kitchen": {"label": "Kitchen", "icon": "cooking-pot", "hue": "lime", "words": ["cook", "chef", "kitchen", "caterer", "catering", "steward", "dining"]},
}
CATEGORIES = {
    "repair": {"label": "Something broken", "desk": "maintenance", "icon": "hammer", "hint": "Furniture, doors, windows, locks, roofs"},
    "electrical": {"label": "Electrical", "desk": "maintenance", "icon": "zap", "hint": "Lights, fans, sockets, generator, AC"},
    "plumbing": {"label": "Water and plumbing", "desk": "maintenance", "icon": "waves", "hint": "Taps, toilets, leaks, borehole, tanks"},
    "cleaning": {"label": "Cleaning", "desk": "maintenance", "icon": "sparkle", "hint": "Spills, toilets, rubbish, grass, pests"},
    "it": {"label": "Computers and ICT", "desk": "it", "icon": "laptop", "hint": "Computers, printers, projectors, internet"},
    "store": {"label": "Ask the store", "desk": "store", "icon": "shopping-bag", "hint": "Chalk, markers, paper, cleaning items"},
    "transport": {"label": "Vehicle or trip", "desk": "transport", "icon": "bus", "hint": "Book a bus, a vehicle problem"},
    "security": {"label": "Security concern", "desk": "gate", "icon": "shield", "hint": "Broken fence, strangers, lost keys"},
    "kitchen": {"label": "Meals and kitchen", "desk": "kitchen", "icon": "utensils", "hint": "Extra meals for an event, food concerns"},
}
DUE_DAYS = {"urgent": 1, "normal": 3, "low": 7}
TICKET_FLOW = ["new", "assigned", "working", "waiting", "done", "closed"]
VISITOR_KINDS = {"parent": "Parent or guardian", "visitor": "Visitor", "contractor": "Contractor or artisan", "delivery": "Delivery", "official": "Official (ministry, inspector...)"}
PASS_KINDS = {"home": "Going home", "hospital": "Hospital or clinic", "family": "Family event", "errand": "School errand",
              "excursion": "Excursion or competition", "other": "Other"}
INCIDENT_KINDS = {"injury": "Accident or injury", "fight": "Fight", "bullying": "Bullying", "theft": "Theft or missing item",
                  "damage": "Damage to property", "security": "Security (intruder, break-in)", "fire": "Fire or electrical",
                  "health": "Health emergency", "conduct": "Serious misconduct", "other": "Other"}
SYMPTOMS = ["Fever", "Headache", "Stomach ache", "Vomiting", "Diarrhoea", "Cough", "Catarrh", "Sore throat", "Body pains", "Rash",
            "Injury", "Toothache", "Eye problem", "Period pain", "Dizziness", "Asthma", "Sickle cell crisis", "Other"]
OUTCOMES = {"class": "Back to class", "rest": "Rested, then class", "sick_bay": "Kept in the sick bay", "home": "Sent home", "hospital": "Taken to hospital"}


# ---------- Desks (teams) ----------

def ensure_desks(db: Session, school_id: uuid.UUID) -> None:
    """Put staff on desks by job title (a Security Officer on the gate, a Nurse in the sick bay, a Cook in the kitchen...).
    Runs whenever desks are looked at, so new staff join their team straight away. Anyone a manager took off a desk stays off."""
    have = {(r.desk, r.user_id) for r in db.scalars(select(DeskMember).where(DeskMember.school_id == school_id))}
    for p in db.scalars(select(StaffProfile).where(StaffProfile.school_id == school_id, StaffProfile.user_id.in_(staff_ids(db, school_id) or {uuid.uuid4()}))):
        job = (p.job_title or "").lower()
        for key, d in DESKS.items():
            if (key, p.user_id) not in have and any(w in job for w in d["words"]):
                db.add(DeskMember(school_id=school_id, desk=key, user_id=p.user_id, lead=job.startswith("head") or "chief" in job or "supervisor" in job))
                have.add((key, p.user_id))
    from app.models import Branch, BusRoute, Vehicle
    crew = set(db.scalars(select(Vehicle.driver_user_id).join(Branch, Branch.id == Vehicle.branch_id).where(
        Branch.school_id == school_id, Vehicle.driver_user_id.is_not(None))))
    for r in db.scalars(select(BusRoute).where(BusRoute.school_id == school_id)):
        crew |= {x for x in (r.driver_id, r.attendant_id) if x}
    for uid in crew:
        if ("transport", uid) not in have:
            db.add(DeskMember(school_id=school_id, desk="transport", user_id=uid))
            have.add(("transport", uid))
    db.flush()


def desk_members(db: Session, school_id: uuid.UUID, desk: str) -> set[uuid.UUID]:
    return set(db.scalars(select(DeskMember.user_id).where(DeskMember.school_id == school_id, DeskMember.desk == desk, DeskMember.removed.is_(False))))


def my_desks(db: Session, user: User, school: School) -> list[str]:
    if runs(user, school, "operations"):
        return [d for d in DESKS if d != "sickbay" or rights.has(user, school, "private.health", db)]
    ensure_desks(db, school.id)
    return list(db.scalars(select(DeskMember.desk).where(DeskMember.school_id == school.id, DeskMember.user_id == user.id, DeskMember.removed.is_(False))))


def on_desk(db: Session, user: User, school: School, desk: str, what: str = "", level: str | None = None) -> bool:
    """Works on this desk, or may run operations. The sick bay holds medical records, so it needs the
    medical-records right (the nurses always have it); its use through temporary access is reported."""
    if desk == "sickbay":
        if user.id in desk_members(db, school.id, desk) and not rights.acting(user):
            return True
        return rights.use_private(db, user, school, "health", what)
    if user.id in desk_members(db, school.id, desk):
        return not (level == "change" and rights.acting(user))
    return runs(user, school, "operations", level)


def need_desk(db: Session, user: User, school_id: uuid.UUID, desk: str, what: str = "") -> School:
    s = school_for(db, user, school_id)
    if not on_desk(db, user, s, desk, what):
        if desk == "sickbay":
            raise HTTPException(status.HTTP_403_FORBIDDEN, "private:health|Medical records are private. Ask the principal for access.")
        raise HTTPException(status.HTTP_403_FORBIDDEN, f"Only the {DESKS[desk]['label'].lower()} team can do this")
    return s


class Names:
    def __init__(self, db: Session, school_id: uuid.UUID):
        self.db, self.school_id = db, school_id
        self.profiles = {p.user_id: p for p in db.scalars(select(StaffProfile).where(StaffProfile.school_id == school_id))}
        self._u: dict = {}

    def name(self, uid) -> str | None:
        if not uid:
            return None
        if uid not in self._u:
            self._u[uid] = self.db.get(User, uid)
        u, p = self._u[uid], self.profiles.get(uid)
        return " ".join(x for x in [p.title if p else None, u.full_name if u else None] if x) or None

    def card(self, uid) -> dict | None:
        if not uid:
            return None
        p = self.profiles.get(uid)
        return {"user_id": str(uid), "name": self.name(uid), "job_title": p.job_title if p else None, "photo": p.photo if p else None}


def student_card(db: Session, s: Student | None) -> dict | None:
    if not s:
        return None
    c = db.get(SchoolClass, s.class_id) if s.class_id else None
    return {"id": str(s.id), "name": s.full_name, "admission_no": s.admission_no, "class_name": c.name if c else None,
            "gender": s.gender.value, "boarder": s.boarding_status.value == "boarder"}


@router.get("/ops/meta")
def meta(user: User = Depends(current_user)):
    return {"desks": DESKS, "categories": CATEGORIES, "visitor_kinds": VISITOR_KINDS, "pass_kinds": PASS_KINDS,
            "incident_kinds": INCIDENT_KINDS, "symptoms": SYMPTOMS, "outcomes": OUTCOMES}


@router.get("/schools/{school_id}/desks")
def desks(school_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    school_for(db, user, school_id)
    ensure_desks(db, school_id)
    nm = Names(db, school_id)
    rows = list(db.scalars(select(DeskMember).where(DeskMember.school_id == school_id, DeskMember.removed.is_(False))))
    db.commit()
    return [{"key": k, **{x: d[x] for x in ("label", "icon", "hue")},
             "members": sorted([{**nm.card(r.user_id), "lead": r.lead} for r in rows if r.desk == k], key=lambda x: (not x["lead"], x["name"] or ""))}
            for k, d in DESKS.items()]


class DeskIn(BaseModel):
    user_ids: list[uuid.UUID] = Field(max_length=60)
    lead_ids: list[uuid.UUID] = []


@router.put("/schools/{school_id}/desks/{desk}")
def set_desk(school_id: uuid.UUID, desk: str, data: DeskIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    school_for(db, user, school_id, manage=True)
    if desk not in DESKS:
        raise not_found("Desk")
    ensure_desks(db, school_id)
    ids = staff_ids(db, school_id)
    if not set(data.user_ids) <= ids:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Everyone on a desk must be on the staff")
    rows = {r.user_id: r for r in db.scalars(select(DeskMember).where(DeskMember.school_id == school_id, DeskMember.desk == desk))}
    keep = set(data.user_ids)
    for uid, r in rows.items():
        r.removed, r.lead = uid not in keep, uid in data.lead_ids
    for uid in dict.fromkeys(data.user_ids):
        if uid not in rows:
            db.add(DeskMember(school_id=school_id, desk=desk, user_id=uid, lead=uid in data.lead_ids))
    db.commit()
    return desks(school_id, user, db)


# ---------- Helpdesk ----------

class TicketIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    category: str
    title: str = Field(min_length=3, max_length=200)
    details: str | None = Field(default=None, max_length=3000)
    location: str | None = Field(default=None, max_length=120)
    facility_id: uuid.UUID | None = None
    priority: str = Field(default="normal", pattern="^(low|normal|urgent)$")
    photo: str | None = Field(default=None, max_length=700_000)


def ticket_out(t: Ticket, nm: Names, user: User, school: School, db: Session) -> dict:
    team = on_desk(db, user, school, t.desk)
    today = now_wat().date()
    open_ = t.status not in ("done", "closed")
    f = db.get(Facility, t.facility_id) if t.facility_id else None
    return {"id": str(t.id), "number": t.number, "desk": t.desk, "category": t.category, "title": t.title, "details": t.details,
            "location": t.location or (f.name if f else None), "facility_id": str(t.facility_id) if t.facility_id else None,
            "priority": t.priority, "status": t.status,
            "raised_by": nm.card(t.raised_by_id), "assigned_to": nm.card(t.assigned_to_id),
            "due_on": t.due_on.isoformat() if t.due_on else None, "overdue": bool(open_ and t.due_on and t.due_on < today),
            "photo": t.photo, "created_at": t.created_at.isoformat(), "done_at": t.done_at.isoformat() if t.done_at else None,
            "rating": t.rating, "feedback": t.feedback, "cost": t.cost if team else None, "comments": t.comments,
            "can_work": team, "is_mine": t.raised_by_id == user.id,
            "can_rate": t.raised_by_id == user.id and t.status == "done"}


@router.post("/schools/{school_id}/tickets", status_code=201)
def raise_ticket(school_id: uuid.UUID, data: TicketIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    school = school_for(db, user, school_id)
    cat = CATEGORIES.get(data.category)
    if not cat:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Choose what kind of problem it is")
    if data.photo and not data.photo.startswith("data:image/"):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "The photo must be a picture")
    n = (db.scalar(select(func.max(Ticket.number)).where(Ticket.school_id == school_id)) or 0) + 1
    t = Ticket(school_id=school_id, number=n, desk=cat["desk"], raised_by_id=user.id, status="new",
               due_on=now_wat().date() + timedelta(days=DUE_DAYS[data.priority]), comments=[], **data.model_dump())
    db.add(t)
    db.commit()
    return ticket_out(t, Names(db, school_id), user, school, db)


@router.get("/schools/{school_id}/tickets")
def list_tickets(school_id: uuid.UUID, scope: str = Query("mine", pattern="^(mine|desk|all)$"), desk: str | None = None,
                 open_only: bool = False, user: User = Depends(current_user), db: Session = Depends(get_db)):
    school = school_for(db, user, school_id)
    q = select(Ticket).where(Ticket.school_id == school_id)
    if scope == "mine":
        q = q.where(or_(Ticket.raised_by_id == user.id, Ticket.assigned_to_id == user.id))
    else:
        allowed = my_desks(db, user, school)
        if scope == "all" and not runs(user, school):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the people who run the school see every job")
        if desk:
            if desk not in allowed:
                raise HTTPException(status.HTTP_403_FORBIDDEN, "You're not on that desk")
            q = q.where(Ticket.desk == desk)
        else:
            q = q.where(Ticket.desk.in_(allowed or ["-"]))
    if open_only:
        q = q.where(Ticket.status.not_in(["done", "closed"]))
    nm = Names(db, school_id)
    rows = list(db.scalars(q.order_by(Ticket.created_at.desc()).limit(400)))
    pr = {"urgent": 0, "normal": 1, "low": 2}
    rows.sort(key=lambda t: (t.status in ("done", "closed"), pr.get(t.priority, 1), t.due_on or date.max))
    out = [ticket_out(t, nm, user, school, db) for t in rows]
    db.commit()
    return out


def get_ticket(db: Session, user: User, tid: uuid.UUID) -> tuple[Ticket, School]:
    t = db.get(Ticket, tid)
    if not t:
        raise not_found("Job")
    school = school_for(db, user, t.school_id)
    if not (t.raised_by_id == user.id or t.assigned_to_id == user.id or on_desk(db, user, school, t.desk)):
        raise not_found("Job")
    return t, school


class TicketAction(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    action: str = Field(pattern="^(assign|start|wait|done|reopen|close|comment|rate|priority|move)$")
    user_id: uuid.UUID | None = None
    text: str | None = Field(default=None, max_length=1000)
    rating: int | None = Field(default=None, ge=1, le=5)
    cost: float | None = Field(default=None, ge=0, le=100_000_000)
    priority: str | None = Field(default=None, pattern="^(low|normal|urgent)$")
    desk: str | None = None


@router.put("/tickets/{tid}")
def act(tid: uuid.UUID, data: TicketAction, user: User = Depends(current_user), db: Session = Depends(get_db)):
    t, school = get_ticket(db, user, tid)
    team = on_desk(db, user, school, t.desk)
    now = datetime.now(timezone.utc)
    note = None
    a = data.action
    if a in ("assign", "start", "wait", "done", "priority", "move") and not (team or t.assigned_to_id == user.id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the desk's team can work on this job")
    if a == "assign":
        uid = data.user_id or user.id
        if uid not in desk_members(db, t.school_id, t.desk) and not (runs(user, school) and uid in staff_ids(db, t.school_id)):
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Choose someone on this desk")
        t.assigned_to_id = uid
        t.status = "assigned" if t.status == "new" else t.status
        note = f"Given to {Names(db, t.school_id).name(uid)}"
    elif a == "start":
        t.status = "working"
        t.assigned_to_id = t.assigned_to_id or user.id
        note = "Started work"
    elif a == "wait":
        t.status = "waiting"
        note = "Waiting" + (f": {data.text}" if data.text else " (parts, money or approval)")
    elif a == "done":
        t.status, t.done_at = "done", now
        if data.cost is not None:
            t.cost = data.cost
        note = "Done" + (f": {data.text}" if data.text else "")
    elif a == "priority":
        t.priority = data.priority or t.priority
        t.due_on = t.created_at.astimezone(WAT).date() + timedelta(days=DUE_DAYS[t.priority])
        note = f"Priority set to {t.priority}"
    elif a == "move":
        if data.desk not in DESKS:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Choose a desk")
        t.desk, t.assigned_to_id, t.status = data.desk, None, "new"
        note = f"Passed to {DESKS[data.desk]['label']}"
    elif a == "reopen":
        if not (t.raised_by_id == user.id or team) or t.status not in ("done", "closed"):
            raise HTTPException(status.HTTP_409_CONFLICT, "Only a finished job can be reopened")
        t.status, t.done_at, t.rating = "assigned" if t.assigned_to_id else "new", None, None
        note = "Reopened" + (f": {data.text}" if data.text else "")
    elif a == "close":
        if not (t.raised_by_id == user.id or runs(user, school)):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the person who asked can close this")
        t.status = "closed"
        t.done_at = t.done_at or now
        note = "Closed" + (f": {data.text}" if data.text else "")
    elif a == "rate":
        if t.raised_by_id != user.id or t.status not in ("done", "closed"):
            raise HTTPException(status.HTTP_409_CONFLICT, "You can rate a job once it is done")
        t.rating, t.feedback, t.status = data.rating, data.text, "closed"
        note = f"Rated {data.rating} of 5" + (f": {data.text}" if data.text else "")
    elif a == "comment":
        if not data.text:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Write a comment")
        note = data.text
    t.comments = [*t.comments, {"at": now.isoformat(), "by": str(user.id), "name": user.full_name, "text": note, "kind": a}]
    db.commit()
    return ticket_out(t, Names(db, t.school_id), user, school, db)


@router.get("/schools/{school_id}/tickets/summary")
def tickets_summary(school_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    school = school_for(db, user, school_id)
    allowed = my_desks(db, user, school)
    if not allowed:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You're not on any desk")
    today = now_wat().date()
    since = datetime.now(timezone.utc) - timedelta(days=60)
    rows = list(db.scalars(select(Ticket).where(Ticket.school_id == school_id, Ticket.desk.in_(allowed), Ticket.created_at >= since)))
    older_open = list(db.scalars(select(Ticket).where(Ticket.school_id == school_id, Ticket.desk.in_(allowed), Ticket.created_at < since,
                                                      Ticket.status.not_in(["done", "closed"]))))
    rows += older_open
    per_desk = {}
    for d in allowed:
        r = [t for t in rows if t.desk == d]
        fixed = [t for t in r if t.done_at]
        hours = [(t.done_at - t.created_at).total_seconds() / 3600 for t in fixed]
        rated = [t.rating for t in r if t.rating]
        per_desk[d] = {"open": sum(1 for t in r if t.status not in ("done", "closed")),
                       "overdue": sum(1 for t in r if t.status not in ("done", "closed") and t.due_on and t.due_on < today),
                       "urgent": sum(1 for t in r if t.status not in ("done", "closed") and t.priority == "urgent"),
                       "done_30": sum(1 for t in fixed if t.done_at >= datetime.now(timezone.utc) - timedelta(days=30)),
                       "avg_hours": round(mean(hours), 1) if hours else None, "rating": round(mean(rated), 1) if rated else None}
    # Places that keep breaking
    places = Counter((t.location or "").strip().lower() for t in rows if t.location and t.desk == "maintenance"
                     and t.created_at >= datetime.now(timezone.utc) - timedelta(days=30))
    nice = {}
    for t in rows:
        if t.location:
            nice.setdefault(t.location.strip().lower(), t.location.strip())
    tips = []
    for place, n in places.most_common(3):
        if n >= 3:
            cats = Counter(t.category for t in rows if (t.location or "").strip().lower() == place and t.desk == "maintenance")
            c = cats.most_common(1)[0][0]
            tips.append({"kind": "alert", "icon": "place", "text": f"{nice[place]}: {n} jobs in the last 30 days, mostly {CATEGORIES[c]['label'].lower()}. A proper repair may cost less than patching it again."})
    od = sum(v["overdue"] for v in per_desk.values())
    if od:
        tips.append({"kind": "alert", "icon": "timer", "text": f"{od} job{' is' if od == 1 else 's are'} past the due date."})
    unassigned = [t for t in rows if t.status == "new" and t.created_at <= datetime.now(timezone.utc) - timedelta(hours=24)]
    if unassigned:
        tips.append({"kind": "tip", "icon": "inbox", "text": f"{len(unassigned)} job{' has' if len(unassigned) == 1 else 's have'} waited more than a day without anyone taking them."})
    low = [t for t in rows if t.rating and t.rating <= 2]
    if low:
        tips.append({"kind": "tip", "icon": "message", "text": f"{len(low)} jobs were rated 2 stars or less. Worth reading the comments."})
    spend = sum(t.cost or 0 for t in rows if t.done_at and t.done_at >= datetime.now(timezone.utc) - timedelta(days=30))
    if spend:
        tips.append({"kind": "tip", "icon": "banknote", "text": f"₦{spend:,.0f} spent on parts in the last 30 days."})
    db.commit()
    return {"desks": per_desk, "insights": tips}


# ---------- Students (light search for the gate, sick bay and incidents) ----------

@router.get("/schools/{school_id}/ops/students")
def find_students(school_id: uuid.UUID, q: str = Query("", max_length=60), user: User = Depends(current_user), db: Session = Depends(get_db)):
    school_for(db, user, school_id)
    q = q.strip()
    if len(q) < 2:
        return []
    like = f"%{q}%"
    rows = db.scalars(select(Student).where(Student.school_id == school_id, Student.status == StudentStatus.active, or_(
        Student.first_name.ilike(like), Student.last_name.ilike(like), Student.admission_no.ilike(like),
        func.concat(Student.first_name, " ", Student.last_name).ilike(like))).order_by(Student.first_name).limit(15))
    return [student_card(db, s) for s in rows]


# ---------- Gate: visitors ----------

class VisitorIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    kind: str = "visitor"
    name: str = Field(min_length=2, max_length=120)
    phone: str | None = Field(default=None, max_length=30)
    organisation: str | None = Field(default=None, max_length=120)
    purpose: str = Field(min_length=2, max_length=200)
    to_see: str | None = Field(default=None, max_length=120)
    to_see_user_id: uuid.UUID | None = None
    student_id: uuid.UUID | None = None
    badge: str | None = Field(default=None, max_length=20)
    vehicle: str | None = Field(default=None, max_length=30)
    people: int = Field(default=1, ge=1, le=60)
    note: str | None = Field(default=None, max_length=300)


def visitor_out(v: Visitor, nm: Names, db: Session) -> dict:
    return {"id": str(v.id), "kind": v.kind, "kind_label": VISITOR_KINDS.get(v.kind, v.kind), "name": v.name, "phone": v.phone,
            "organisation": v.organisation, "purpose": v.purpose, "to_see": v.to_see or nm.name(v.to_see_user_id),
            "to_see_user_id": str(v.to_see_user_id) if v.to_see_user_id else None,
            "student": student_card(db, db.get(Student, v.student_id)) if v.student_id else None,
            "badge": v.badge, "vehicle": v.vehicle, "people": v.people, "time_in": v.time_in.isoformat(),
            "time_out": v.time_out.isoformat() if v.time_out else None, "note": v.note, "logged_by": nm.name(v.logged_by_id)}


@router.post("/schools/{school_id}/visitors", status_code=201)
def visitor_in(school_id: uuid.UUID, data: VisitorIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    need_desk(db, user, school_id, "gate")
    if data.kind not in VISITOR_KINDS:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Choose the kind of visitor")
    if data.to_see_user_id and data.to_see_user_id not in staff_ids(db, school_id):
        raise not_found("Staff member")
    v = Visitor(school_id=school_id, time_in=datetime.now(timezone.utc), logged_by_id=user.id, **data.model_dump())
    db.add(v)
    db.commit()
    return visitor_out(v, Names(db, school_id), db)


@router.put("/visitors/{vid}/out")
def visitor_out_(vid: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    v = db.get(Visitor, vid)
    if not v:
        raise not_found("Visitor")
    need_desk(db, user, v.school_id, "gate")
    v.time_out = None if v.time_out else datetime.now(timezone.utc)
    db.commit()
    return visitor_out(v, Names(db, v.school_id), db)


@router.get("/schools/{school_id}/visitors")
def visitors(school_id: uuid.UUID, on: date | None = Query(None, alias="date"), q: str | None = None,
             user: User = Depends(current_user), db: Session = Depends(get_db)):
    need_desk(db, user, school_id, "gate")
    query = select(Visitor).where(Visitor.school_id == school_id)
    if q:
        like = f"%{q.strip()}%"
        query = query.where(or_(Visitor.name.ilike(like), Visitor.phone.ilike(like), Visitor.vehicle.ilike(like), Visitor.organisation.ilike(like)))
    else:
        day = on or now_wat().date()
        start = datetime.combine(day, time(0), WAT)
        query = query.where(or_(Visitor.time_in.between(start, start + timedelta(days=1)), Visitor.time_out.is_(None)))
    nm = Names(db, school_id)
    return [visitor_out(v, nm, db) for v in db.scalars(query.order_by(Visitor.time_in.desc()).limit(300))]


# ---------- Gate: student exit passes ----------

class PassIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    student_id: uuid.UUID
    kind: str = "home"
    reason: str = Field(min_length=3, max_length=300)
    leave_at: datetime
    return_by: datetime | None = None
    escort_name: str | None = Field(default=None, max_length=120)
    escort_phone: str | None = Field(default=None, max_length=30)
    escort_relation: str | None = Field(default=None, max_length=40)


def may_approve_pass(db: Session, user: User, school: School) -> bool:
    if runs(user, school):
        return True
    return bool(db.scalar(select(Membership.id).where(Membership.user_id == user.id, Membership.school_id == school.id, Membership.role == Role.house_parent)))


def may_request_pass(db: Session, user: User, school: School, student: Student) -> bool:
    if may_approve_pass(db, user, school):
        return True
    c = db.get(SchoolClass, student.class_id) if student.class_id else None
    return bool(c and c.form_teacher_id == user.id)


def pass_out(p: GatePass, nm: Names, db: Session, user: User, school: School) -> dict:
    now = datetime.now(timezone.utc)
    s = db.get(Student, p.student_id)
    guardians = []
    if s:
        # Only people allowed to collect the student (set on the student's profile).
        for g in db.scalars(select(StudentGuardian).where(StudentGuardian.student_id == s.id, StudentGuardian.can_pick_up.is_(True))):
            u = db.get(User, g.user_id)
            if u:
                guardians.append({"name": u.full_name, "phone": u.phone, "relation": g.relationship_label})
        from app.models import StudentContact
        for c in db.scalars(select(StudentContact).where(StudentContact.student_id == s.id)):
            guardians.append({"name": c.name, "phone": c.phone, "relation": c.relationship_label})
    health = db.scalar(select(StudentHealth).where(StudentHealth.student_id == p.student_id))
    return {"id": str(p.id), "code": p.code, "student": student_card(db, s), "kind": p.kind, "kind_label": PASS_KINDS.get(p.kind, p.kind),
            "reason": p.reason, "leave_at": p.leave_at.isoformat(), "return_by": p.return_by.isoformat() if p.return_by else None,
            "escort_name": p.escort_name, "escort_phone": p.escort_phone, "escort_relation": p.escort_relation,
            "guardians": guardians, "status": p.status, "requested_by": nm.name(p.requested_by_id), "approved_by": nm.name(p.approved_by_id),
            "decision_note": p.decision_note, "left_at": p.left_at.isoformat() if p.left_at else None,
            "returned_at": p.returned_at.isoformat() if p.returned_at else None,
            "late": bool(p.status == "out" and p.return_by and p.return_by < now),
            "medical_note": bool(health and (health.conditions or health.allergies)),
            "can_decide": p.status == "requested" and may_approve_pass(db, user, school),
            "can_gate": p.status in ("approved", "out") and on_desk(db, user, school, "gate"),
            "can_cancel": p.status in ("requested", "approved") and (p.requested_by_id == user.id or may_approve_pass(db, user, school))}


@router.post("/schools/{school_id}/passes", status_code=201)
def request_pass(school_id: uuid.UUID, data: PassIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    school = school_for(db, user, school_id)
    s = db.get(Student, data.student_id)
    if not s or s.school_id != school_id:
        raise not_found("Student")
    if not may_request_pass(db, user, school, s):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the student's class teacher, a house parent or the principal can ask for an exit pass")
    if data.kind not in PASS_KINDS:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Choose the kind of pass")
    if data.return_by and data.return_by <= data.leave_at:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Return time must be after leaving time")
    busy = db.scalar(select(GatePass.id).where(GatePass.student_id == s.id, GatePass.status.in_(["requested", "approved", "out"])))
    if busy:
        raise HTTPException(status.HTTP_409_CONFLICT, "This student already has an open pass")
    p = GatePass(school_id=school_id, code=secrets.token_hex(3).upper(), requested_by_id=user.id, **data.model_dump())
    if may_approve_pass(db, user, school):
        p.status, p.approved_by_id = "approved", user.id
    db.add(p)
    db.commit()
    return pass_out(p, Names(db, school_id), db, user, school)


@router.get("/schools/{school_id}/passes")
def list_passes(school_id: uuid.UUID, view: str = Query("open", pattern="^(open|today|history|mine)$"),
                user: User = Depends(current_user), db: Session = Depends(get_db)):
    school = school_for(db, user, school_id)
    q = select(GatePass).where(GatePass.school_id == school_id)
    sees_all = may_approve_pass(db, user, school) or on_desk(db, user, school, "gate")
    if view == "mine" or not sees_all:
        q = q.where(GatePass.requested_by_id == user.id)
    if view == "open":
        q = q.where(GatePass.status.in_(["requested", "approved", "out"]))
    elif view == "today":
        start = datetime.combine(now_wat().date(), time(0), WAT)
        q = q.where(or_(GatePass.status == "out", (GatePass.status == "approved") & (GatePass.leave_at < start + timedelta(days=1)),
                        GatePass.returned_at >= start))
    nm = Names(db, school_id)
    rows = db.scalars(q.order_by(GatePass.leave_at.desc()).limit(300))
    return [pass_out(p, nm, db, user, school) for p in rows]


class PassAction(BaseModel):
    action: str = Field(pattern="^(approve|decline|out|in|cancel)$")
    note: str | None = Field(default=None, max_length=300)


@router.put("/passes/{pid}")
def pass_action(pid: uuid.UUID, data: PassAction, user: User = Depends(current_user), db: Session = Depends(get_db)):
    p = db.get(GatePass, pid)
    if not p:
        raise not_found("Pass")
    school = school_for(db, user, p.school_id)
    now = datetime.now(timezone.utc)
    a = data.action
    if a in ("approve", "decline"):
        if not may_approve_pass(db, user, school) or p.status != "requested":
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Only a house parent or the principal can decide, while it is waiting")
        p.status, p.approved_by_id, p.decision_note = ("approved" if a == "approve" else "declined"), user.id, data.note
    elif a == "out":
        if not on_desk(db, user, school, "gate") or p.status != "approved":
            raise HTTPException(status.HTTP_409_CONFLICT, "Only an approved pass can be used at the gate")
        p.status, p.left_at, p.out_by_id = "out", now, user.id
    elif a == "in":
        if not on_desk(db, user, school, "gate") or p.status != "out":
            raise HTTPException(status.HTTP_409_CONFLICT, "This student isn't out")
        p.status, p.returned_at, p.in_by_id = "returned", now, user.id
    elif a == "cancel":
        if p.status not in ("requested", "approved") or not (p.requested_by_id == user.id or may_approve_pass(db, user, school)):
            raise HTTPException(status.HTTP_409_CONFLICT, "This pass can't be cancelled now")
        p.status = "cancelled"
    db.commit()
    return pass_out(p, Names(db, p.school_id), db, user, school)


@router.get("/schools/{school_id}/passes/code/{code}")
def pass_by_code(school_id: uuid.UUID, code: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    school = need_desk(db, user, school_id, "gate")
    code = re.sub(r"[^A-Za-z0-9]", "", code).upper()
    p = db.scalar(select(GatePass).where(GatePass.school_id == school_id, GatePass.code == code).order_by(GatePass.created_at.desc()))
    if not p:
        raise not_found("Pass")
    return pass_out(p, Names(db, school_id), db, user, school)


@router.get("/schools/{school_id}/gate")
def gate_board(school_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Everything the gate needs right now."""
    need_desk(db, user, school_id, "gate")
    vis = visitors(school_id, None, None, user, db)
    passes = list_passes(school_id, "today", user, db)
    now = datetime.now(timezone.utc)
    late_back = [p for p in passes if p["late"]]
    inside = [v for v in vis if not v["time_out"]]
    long_stay = [v for v in inside if (now - datetime.fromisoformat(v["time_in"])).total_seconds() > 4 * 3600]
    tips = []
    if late_back:
        tips.append({"kind": "alert", "icon": "timer", "text": f"{len(late_back)} student{'s' if len(late_back) > 1 else ''} should be back by now: " + ", ".join(p["student"]["name"] for p in late_back[:4]) + "."})
    if long_stay:
        tips.append({"kind": "tip", "icon": "users", "text": f"{len(long_stay)} visitor{'s have' if len(long_stay) > 1 else ' has'} been in for over 4 hours."})
    return {"visitors": vis, "inside": len(inside), "passes": passes,
            "out": sum(1 for p in passes if p["status"] == "out"), "leaving": sum(1 for p in passes if p["status"] == "approved"), "insights": tips}


# ---------- Incidents ----------

class IncidentIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    kind: str
    severity: str = Field(default="minor", pattern="^(minor|serious|critical)$")
    occurred_at: datetime
    location: str | None = Field(default=None, max_length=120)
    summary: str = Field(min_length=3, max_length=200)
    description: str | None = Field(default=None, max_length=5000)
    student_ids: list[uuid.UUID] = Field(default=[], max_length=30)
    staff_ids: list[uuid.UUID] = Field(default=[], max_length=30)
    others: str | None = Field(default=None, max_length=300)
    action_taken: str | None = Field(default=None, max_length=3000)


def sees_incident(db: Session, user: User, school: School, i: Incident) -> bool:
    if i.reported_by_id == user.id or i.assigned_to_id == user.id:
        return True
    if user.__dict__.get("_safeguarding") is None:
        user.__dict__["_safeguarding"] = rights.use_private(db, user, school, "safeguarding")
    if user.__dict__["_safeguarding"]:
        return True
    if i.kind in ("security", "theft", "damage", "fire") and user.id in desk_members(db, school.id, "gate"):
        return True
    return i.kind in ("health", "injury") and on_desk(db, user, school, "sickbay")


def incident_out(i: Incident, nm: Names, db: Session, user: User, school: School) -> dict:
    return {"id": str(i.id), "number": i.number, "kind": i.kind, "kind_label": INCIDENT_KINDS.get(i.kind, i.kind), "severity": i.severity,
            "occurred_at": i.occurred_at.isoformat(), "location": i.location, "summary": i.summary, "description": i.description,
            "students": [student_card(db, db.get(Student, uuid.UUID(x))) for x in i.student_ids if db.get(Student, uuid.UUID(x))],
            "staff": [nm.card(uuid.UUID(x)) for x in i.staff_ids], "others": i.others, "action_taken": i.action_taken,
            "reported_by": nm.card(i.reported_by_id), "assigned_to": nm.card(i.assigned_to_id), "status": i.status, "outcome": i.outcome,
            "parents_informed": i.parents_informed, "notes": i.notes, "created_at": i.created_at.isoformat(),
            "can_manage": i.assigned_to_id == user.id or (rights.has(user, school, "private.safeguarding", db) and not rights.acting(user))}


@router.post("/schools/{school_id}/incidents", status_code=201)
def report_incident(school_id: uuid.UUID, data: IncidentIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    school = school_for(db, user, school_id)
    if data.kind not in INCIDENT_KINDS:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Choose what happened")
    for sid_ in data.student_ids:
        s = db.get(Student, sid_)
        if not s or s.school_id != school_id:
            raise not_found("Student")
    if not set(data.staff_ids) <= staff_ids(db, school_id):
        raise not_found("Staff member")
    n = (db.scalar(select(func.max(Incident.number)).where(Incident.school_id == school_id)) or 0) + 1
    body = data.model_dump()
    body["student_ids"] = [str(x) for x in data.student_ids]
    body["staff_ids"] = [str(x) for x in data.staff_ids]
    i = Incident(school_id=school_id, number=n, reported_by_id=user.id, status="open", notes=[], **body)
    db.add(i)
    db.commit()
    return incident_out(i, Names(db, school_id), db, user, school)


@router.get("/schools/{school_id}/incidents")
def list_incidents(school_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    school = school_for(db, user, school_id)
    nm = Names(db, school_id)
    rows = [i for i in db.scalars(select(Incident).where(Incident.school_id == school_id).order_by(Incident.occurred_at.desc()).limit(500))
            if sees_incident(db, user, school, i)]
    sev = {"critical": 0, "serious": 1, "minor": 2}
    rows.sort(key=lambda i: (i.status == "closed", sev.get(i.severity, 3), -i.occurred_at.timestamp()))
    return [incident_out(i, nm, db, user, school) for i in rows]


class IncidentUpdate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    status: str | None = Field(default=None, pattern="^(open|investigating|closed)$")
    severity: str | None = Field(default=None, pattern="^(minor|serious|critical)$")
    assigned_to_id: uuid.UUID | None = None
    action_taken: str | None = Field(default=None, max_length=3000)
    outcome: str | None = Field(default=None, max_length=3000)
    parents_informed: bool | None = None
    note: str | None = Field(default=None, max_length=1000)


@router.put("/incidents/{iid}")
def update_incident(iid: uuid.UUID, data: IncidentUpdate, user: User = Depends(current_user), db: Session = Depends(get_db)):
    i = db.get(Incident, iid)
    if not i:
        raise not_found("Incident")
    school = school_for(db, user, i.school_id)
    if not sees_incident(db, user, school, i):
        raise not_found("Incident")
    manage = i.assigned_to_id == user.id or rights.use_private(db, user, school, "safeguarding", f"incident #{i.number}")
    changes = data.model_dump(exclude_unset=True)
    note = changes.pop("note", None)
    if changes and not manage:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the principal or the person following it up can change this")
    if "assigned_to_id" in changes and changes["assigned_to_id"] and changes["assigned_to_id"] not in staff_ids(db, i.school_id):
        raise not_found("Staff member")
    if changes.get("status") == "closed" and not (changes.get("outcome") or i.outcome):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Write the outcome before closing")
    for k, v in changes.items():
        setattr(i, k, v)
    if note:
        i.notes = [*i.notes, {"at": datetime.now(timezone.utc).isoformat(), "by": str(user.id), "name": user.full_name, "text": note}]
    db.commit()
    return incident_out(i, Names(db, i.school_id), db, user, school)


# ---------- Sick bay ----------

class HealthIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    blood_group: str | None = Field(default=None, pattern="^(A|B|AB|O)[+-]$")
    genotype: str | None = Field(default=None, pattern="^(AA|AS|AC|SS|SC|CC)$")
    allergies: str | None = Field(default=None, max_length=300)
    conditions: str | None = Field(default=None, max_length=300)
    medications: str | None = Field(default=None, max_length=300)
    diet: str | None = Field(default=None, max_length=200)
    hospital: str | None = Field(default=None, max_length=150)
    notes: str | None = Field(default=None, max_length=3000)


def health_out(h: StudentHealth | None) -> dict | None:
    if not h:
        return None
    return {k: getattr(h, k) for k in ("blood_group", "genotype", "allergies", "conditions", "medications", "diet", "hospital", "notes")}


@router.get("/students/{student_id}/health")
def get_health(student_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    s = db.get(Student, student_id)
    if not s:
        raise not_found("Student")
    school = school_for(db, user, s.school_id)
    h = db.scalar(select(StudentHealth).where(StudentHealth.student_id == student_id))
    nurse = on_desk(db, user, school, "sickbay", f"{s.first_name} {s.last_name}")
    out = health_out(h)
    if out and not nurse:
        out["notes"] = None   # the nurse's own notes stay in the sick bay
    visits = []
    if nurse:
        nm = Names(db, s.school_id)
        visits = [visit_out(v, nm, db) for v in db.scalars(select(ClinicVisit).where(ClinicVisit.student_id == student_id).order_by(ClinicVisit.seen_at.desc()).limit(30))]
    return {"student": student_card(db, s), "health": out, "can_edit": nurse, "visits": visits}


@router.put("/students/{student_id}/health")
def put_health(student_id: uuid.UUID, data: HealthIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    s = db.get(Student, student_id)
    if not s:
        raise not_found("Student")
    need_desk(db, user, s.school_id, "sickbay", f"{s.first_name} {s.last_name}")
    h = db.scalar(select(StudentHealth).where(StudentHealth.student_id == student_id))
    if not h:
        h = StudentHealth(student_id=student_id)
        db.add(h)
    for k, v in data.model_dump().items():
        setattr(h, k, v or None)
    h.updated_by_id = user.id
    db.commit()
    return get_health(student_id, user, db)


class MedicineGiven(BaseModel):
    stock_id: uuid.UUID | None = None
    name: str = Field(min_length=1, max_length=120)
    quantity: float = Field(default=1, gt=0, le=1000)
    dose: str | None = Field(default=None, max_length=80)


class VisitIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    student_id: uuid.UUID | None = None
    staff_user_id: uuid.UUID | None = None
    complaint: str = Field(min_length=2, max_length=200)
    symptoms: list[str] = Field(default=[], max_length=12)
    temperature: float | None = Field(default=None, ge=30, le=45)
    treatment: str | None = Field(default=None, max_length=3000)
    medicines: list[MedicineGiven] = Field(default=[], max_length=10)
    outcome: str = "class"
    parent_informed: bool = False
    follow_up_on: date | None = None


def visit_out(v: ClinicVisit, nm: Names, db: Session) -> dict:
    s = db.get(Student, v.student_id) if v.student_id else None
    h = db.scalar(select(StudentHealth).where(StudentHealth.student_id == v.student_id)) if v.student_id else None
    return {"id": str(v.id), "student": student_card(db, s), "staff": nm.card(v.staff_user_id), "seen_at": v.seen_at.isoformat(),
            "complaint": v.complaint, "symptoms": v.symptoms, "temperature": v.temperature, "treatment": v.treatment, "medicines": v.medicines,
            "outcome": v.outcome, "outcome_label": OUTCOMES.get(v.outcome, v.outcome), "parent_informed": v.parent_informed,
            "follow_up_on": v.follow_up_on.isoformat() if v.follow_up_on else None,
            "discharged_at": v.discharged_at.isoformat() if v.discharged_at else None, "nurse": nm.name(v.nurse_id),
            "health": health_out(h)}


@router.post("/schools/{school_id}/clinic/visits", status_code=201)
def add_visit(school_id: uuid.UUID, data: VisitIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    need_desk(db, user, school_id, "sickbay")
    if bool(data.student_id) == bool(data.staff_user_id):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Choose one student or one member of staff")
    if data.student_id:
        s = db.get(Student, data.student_id)
        if not s or s.school_id != school_id:
            raise not_found("Student")
    if data.staff_user_id and data.staff_user_id not in staff_ids(db, school_id):
        raise not_found("Staff member")
    if data.outcome not in OUTCOMES:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Choose what happened next")
    meds = []
    for m in data.medicines:
        if m.stock_id:
            st = db.get(MedicineStock, m.stock_id)
            if not st or st.school_id != school_id:
                raise not_found("Medicine")
            if st.quantity < m.quantity:
                raise HTTPException(status.HTTP_409_CONFLICT, f"Only {st.quantity:g} {st.unit} of {st.name} left in stock")
            st.quantity -= m.quantity
        meds.append({**m.model_dump(mode="json")})
    v = ClinicVisit(school_id=school_id, nurse_id=user.id, seen_at=datetime.now(timezone.utc), **data.model_dump(exclude={"medicines"}), medicines=meds)
    db.add(v)
    db.commit()
    return visit_out(v, Names(db, school_id), db)


class VisitUpdate(BaseModel):
    outcome: str | None = None
    parent_informed: bool | None = None
    treatment: str | None = Field(default=None, max_length=3000)
    discharge: bool = False
    follow_up_on: date | None = None


@router.put("/clinic/visits/{vid}")
def update_visit(vid: uuid.UUID, data: VisitUpdate, user: User = Depends(current_user), db: Session = Depends(get_db)):
    v = db.get(ClinicVisit, vid)
    if not v:
        raise not_found("Visit")
    need_desk(db, user, v.school_id, "sickbay")
    if data.outcome:
        if data.outcome not in OUTCOMES:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Choose what happened next")
        v.outcome = data.outcome
    for k in ("parent_informed", "treatment", "follow_up_on"):
        if getattr(data, k) is not None:
            setattr(v, k, getattr(data, k))
    if data.discharge:
        v.discharged_at = datetime.now(timezone.utc)
    db.commit()
    return visit_out(v, Names(db, v.school_id), db)


@router.get("/schools/{school_id}/clinic")
def clinic(school_id: uuid.UUID, on: date | None = Query(None, alias="date"), user: User = Depends(current_user), db: Session = Depends(get_db)):
    """The sick bay's day: who came, who is lying in, follow-ups, stock warnings and early warnings."""
    need_desk(db, user, school_id, "sickbay")
    nm = Names(db, school_id)
    today = now_wat().date()
    day = on or today
    start = datetime.combine(day, time(0), WAT)
    visits = list(db.scalars(select(ClinicVisit).where(ClinicVisit.school_id == school_id, ClinicVisit.seen_at >= start,
                                                       ClinicVisit.seen_at < start + timedelta(days=1)).order_by(ClinicVisit.seen_at.desc())))
    lying_in = list(db.scalars(select(ClinicVisit).where(ClinicVisit.school_id == school_id, ClinicVisit.outcome == "sick_bay", ClinicVisit.discharged_at.is_(None))))
    follow = list(db.scalars(select(ClinicVisit).where(ClinicVisit.school_id == school_id, ClinicVisit.follow_up_on.is_not(None),
                                                       ClinicVisit.follow_up_on <= today, ClinicVisit.follow_up_on >= today - timedelta(days=3))))
    recent = list(db.scalars(select(ClinicVisit).where(ClinicVisit.school_id == school_id, ClinicVisit.seen_at >= datetime.now(timezone.utc) - timedelta(days=28))))
    stock = list(db.scalars(select(MedicineStock).where(MedicineStock.school_id == school_id).order_by(MedicineStock.name)))
    now = datetime.now(timezone.utc)
    d7, d14 = now - timedelta(days=7), now - timedelta(days=14)

    tips = []
    # Early warning: the same symptom suddenly much more common
    this_w = Counter(s for v in recent if v.seen_at >= d7 for s in v.symptoms)
    last_w = Counter(s for v in recent if d14 <= v.seen_at < d7 for s in v.symptoms)
    rising = [(sym, n) for sym, n in this_w.most_common(6) if n >= 5 and n >= 2 * max(1, last_w.get(sym, 0))]
    if rising:
        syms = {sym for sym, _ in rising}
        hit = [v for v in recent if v.seen_at >= d7 and syms & set(v.symptoms)]
        where = Counter((db.get(Student, v.student_id).class_id if v.student_id else None) for v in hit)
        cls_id, cn = where.most_common(1)[0]
        cls = db.get(SchoolClass, cls_id) if cls_id else None
        extra = f" {cn} of the {len(hit)} visits are from {cls.name}." if cls and cn >= 3 else ""
        what = ", ".join(f"{sym.lower()} {n} (was {last_w.get(sym, 0)})" for sym, n in rising)
        tips.append({"kind": "alert", "icon": "heart-pulse",
                     "text": f"Possible outbreak: this week {what}.{extra} Check for malaria, food or water problems, and tell the principal."})
    # Students who keep coming
    freq = Counter(v.student_id for v in recent if v.student_id and v.seen_at >= d14)
    regulars = [(sid_, n) for sid_, n in freq.most_common(5) if n >= 3]
    if regulars:
        names = ", ".join(f"{db.get(Student, s).full_name} ({n})" for s, n in regulars)
        tips.append({"kind": "tip", "icon": "user", "text": f"Frequent visitors in the last 2 weeks: {names}. Check for an ongoing illness, or a worry the counsellor should hear about."})
    long_in = [v for v in lying_in if (now - v.seen_at).total_seconds() > 24 * 3600]
    if long_in:
        tips.append({"kind": "alert", "icon": "bed", "text": f"{len(long_in)} {'person has' if len(long_in) == 1 else 'people have'} been in the sick bay for more than a day. Consider a hospital or calling home."})
    not_told = [v for v in recent if v.outcome in ("home", "hospital", "sick_bay") and not v.parent_informed and v.student_id]
    if not_told:
        tips.append({"kind": "alert", "icon": "phone", "text": f"{len(not_told)} student{' was' if len(not_told) == 1 else 's were'} kept in, sent home or taken to hospital without a note that parents were told."})
    low = [m for m in stock if m.quantity <= m.reorder_level]
    if low:
        tips.append({"kind": "tip", "icon": "store", "text": "Running low: " + ", ".join(f"{m.name} ({m.quantity:g} {m.unit})" for m in low[:5]) + "."})
    expiring = [m for m in stock if m.expiry and m.expiry <= today + timedelta(days=30)]
    if expiring:
        tips.append({"kind": "alert", "icon": "calendar-x", "text": "Expired or expiring within 30 days: " + ", ".join(f"{m.name} ({m.expiry:%d %b})" for m in expiring[:5]) + "."})

    week = []
    for i in range(13, -1, -1):
        d = today - timedelta(days=i)
        s0 = datetime.combine(d, time(0), WAT)
        week.append({"date": d.isoformat(), "visits": sum(1 for v in recent if s0 <= v.seen_at < s0 + timedelta(days=1)),
                     "fever": sum(1 for v in recent if s0 <= v.seen_at < s0 + timedelta(days=1) and "Fever" in v.symptoms)})
    return {"date": day.isoformat(), "visits": [visit_out(v, nm, db) for v in visits], "lying_in": [visit_out(v, nm, db) for v in lying_in],
            "follow_ups": [visit_out(v, nm, db) for v in follow], "trend": week,
            "top_symptoms": [{"symptom": s, "count": n} for s, n in Counter(s for v in recent for s in v.symptoms).most_common(6)],
            "stock": [stock_out(m, today) for m in stock], "insights": tips}


class StockIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    name: str = Field(min_length=2, max_length=120)
    unit: str = Field(default="tablet", max_length=20)
    quantity: float = Field(ge=0, le=1_000_000)
    reorder_level: float = Field(default=10, ge=0, le=100_000)
    expiry: date | None = None
    notes: str | None = Field(default=None, max_length=200)


def stock_out(m: MedicineStock, today: date) -> dict:
    return {"id": str(m.id), "name": m.name, "unit": m.unit, "quantity": m.quantity, "reorder_level": m.reorder_level,
            "expiry": m.expiry.isoformat() if m.expiry else None, "notes": m.notes, "low": m.quantity <= m.reorder_level,
            "expired": bool(m.expiry and m.expiry < today), "expiring": bool(m.expiry and today <= m.expiry <= today + timedelta(days=30))}


@router.post("/schools/{school_id}/clinic/stock", status_code=201)
def add_stock(school_id: uuid.UUID, data: StockIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    need_desk(db, user, school_id, "sickbay")
    m = MedicineStock(school_id=school_id, **data.model_dump())
    db.add(m)
    db.commit()
    return stock_out(m, now_wat().date())


@router.put("/clinic/stock/{mid}")
def edit_stock(mid: uuid.UUID, data: StockIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    m = db.get(MedicineStock, mid)
    if not m:
        raise not_found("Medicine")
    need_desk(db, user, m.school_id, "sickbay")
    for k, v in data.model_dump().items():
        setattr(m, k, v)
    db.commit()
    return stock_out(m, now_wat().date())


@router.delete("/clinic/stock/{mid}", status_code=204)
def delete_stock(mid: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    m = db.get(MedicineStock, mid)
    if not m:
        raise not_found("Medicine")
    need_desk(db, user, m.school_id, "sickbay")
    db.delete(m)
    db.commit()
    return Response(status_code=204)


# ---------- Overview for the principal and "my operations" for the portal ----------

@router.get("/schools/{school_id}/ops/overview")
def ops_overview(school_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    school_for(db, user, school_id, manage=True)
    s = tickets_summary(school_id, user, db)
    g = gate_board(school_id, user, db)
    c = clinic(school_id, None, user, db)
    inc = [i for i in list_incidents(school_id, user, db) if i["status"] != "closed"]
    insights = (s["insights"] + g["insights"] + c["insights"])
    serious = [i for i in inc if i["severity"] != "minor"]
    if serious:
        insights.insert(0, {"kind": "alert", "icon": "shield", "text": f"{len(serious)} serious or critical incident{'s are' if len(serious) > 1 else ' is'} still open."})
    return {"tickets": s["desks"], "gate": {"inside": g["inside"], "out": g["out"], "leaving": g["leaving"], "visitors_today": len(g["visitors"])},
            "clinic": {"today": len(c["visits"]), "lying_in": len(c["lying_in"]), "trend": c["trend"], "low_stock": sum(1 for m in c["stock"] if m["low"])},
            "incidents": {"open": len(inc), "serious": len(serious)}, "insights": insights}


@router.get("/me/schools/{school_id}/ops")
def my_ops(school_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    school = school_for(db, user, school_id)
    desks_ = my_desks(db, user, school) if user.id in staff_ids(db, school_id) or runs(user, school) else []
    member_desks = [] if runs(user, school) else desks_
    mine_open = db.scalar(select(func.count()).select_from(Ticket).where(Ticket.school_id == school_id, Ticket.raised_by_id == user.id,
                                                                         Ticket.status.not_in(["closed"]))) or 0
    to_rate = db.scalar(select(func.count()).select_from(Ticket).where(Ticket.school_id == school_id, Ticket.raised_by_id == user.id, Ticket.status == "done")) or 0
    assigned = db.scalar(select(func.count()).select_from(Ticket).where(Ticket.school_id == school_id, Ticket.assigned_to_id == user.id,
                                                                        Ticket.status.not_in(["done", "closed"]))) or 0
    desk_open = {d: db.scalar(select(func.count()).select_from(Ticket).where(Ticket.school_id == school_id, Ticket.desk == d,
                                                                             Ticket.status.not_in(["done", "closed"]))) or 0 for d in member_desks}
    approver = may_approve_pass(db, user, school)
    waiting_passes = db.scalar(select(func.count()).select_from(GatePass).where(GatePass.school_id == school_id, GatePass.status == "requested")) if approver else 0
    form = bool(db.scalar(select(SchoolClass.id).where(SchoolClass.form_teacher_id == user.id).limit(1)))
    db.commit()
    from app.api.logistics import desk_summary
    info = {d: desk_summary(db, user, school, d) for d in member_desks}
    today = now_wat().date()
    start = datetime.combine(today, time(0), tzinfo=WAT)
    if "gate" in member_desks:
        inside = db.scalar(select(func.count()).select_from(Visitor).where(Visitor.school_id == school_id, Visitor.time_out.is_(None),
                                                                           Visitor.time_in >= start - timedelta(days=1))) or 0
        info["gate"] = {"big": str(inside), "line": f"visitor{'s' if inside != 1 else ''} inside now", "more": "Visitors' book and exit passes", "alerts": 0}
    if "library" in member_desks:
        from app.models import Loan
        out_ = db.scalar(select(func.count()).select_from(Loan).where(Loan.school_id == school_id, Loan.returned_at.is_(None))) or 0
        late = db.scalar(select(func.count()).select_from(Loan).where(Loan.school_id == school_id, Loan.returned_at.is_(None), Loan.due_on < today)) or 0
        info["library"] = {"big": str(out_), "line": f"book{'s' if out_ != 1 else ''} on loan", "more": f"{late} overdue" if late else "None overdue", "alerts": late}
    if "sickbay" in member_desks:
        seen = db.scalar(select(func.count()).select_from(ClinicVisit).where(ClinicVisit.school_id == school_id, ClinicVisit.seen_at >= start)) or 0
        info["sickbay"] = {"big": str(seen), "line": f"visit{'s' if seen != 1 else ''} today", "more": "Visits, students lying in and medicine stock", "alerts": 0}
    db.commit()
    return {"desks": [{"key": d, **{x: DESKS[d][x] for x in ("label", "icon", "hue")}, "open": desk_open.get(d, 0), "info": info.get(d)}
                      for d in member_desks],
            "my_open": mine_open, "to_rate": to_rate, "assigned": assigned, "can_request_pass": approver or form,
            "can_approve_pass": approver, "passes_waiting": waiting_passes or 0}


@router.get("/schools/{school_id}/places")
def places(school_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Rooms and buildings anyone on the staff can pick when reporting a problem, so repairs build up a history per place."""
    from app.models import Branch, Hostel
    school_for(db, user, school_id)
    out = [{"id": str(f.id), "name": f.name, "kind": f.kind.value} for f in db.scalars(
        select(Facility).join(Branch, Branch.id == Facility.branch_id).where(Branch.school_id == school_id).order_by(Facility.name))]
    out += [{"id": None, "name": h.name, "kind": "hostel"} for h in db.scalars(
        select(Hostel).join(Branch, Branch.id == Hostel.branch_id).where(Branch.school_id == school_id).order_by(Hostel.name))]
    return out
