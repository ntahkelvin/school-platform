"""Cleaning rotas: the places to clean, who cleans them on which day (cleaners or student labour teams),
ticking off, inspections with stars, and a league of the cleanest places and houses."""
import uuid
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from statistics import mean

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.access import not_found
from app.api.deps import current_user
from app.api.ops import Names, desk_members
from app.api.staff_day import now_wat, runs, school_for, staff_ids
from app.core import rights
from app.core.db import get_db
from app.models import (
    Branch, CleanArea, CleanDuty, CleanLog, DeskMember, Facility, Hostel, Membership, Role, School, Ticket, User,
)

router = APIRouter(prefix="/api", tags=["cleaning"])

KINDS = {"classroom": {"label": "Classrooms", "icon": "classes"}, "toilet": {"label": "Toilets", "icon": "waves"},
         "hostel": {"label": "Hostel", "icon": "bed"}, "compound": {"label": "Compound and grounds", "icon": "trees"},
         "office": {"label": "Offices", "icon": "briefcase"}, "hall": {"label": "Hall or chapel", "icon": "landmark"},
         "kitchen": {"label": "Kitchen and dining", "icon": "utensils"}, "lab": {"label": "Laboratory", "icon": "flask"},
         "other": {"label": "Other", "icon": "sparkle"}}
SHIFTS = {"morning": "Morning", "afternoon": "Afternoon", "evening": "Evening"}
DEFAULT_LIST = {"classroom": ["Sweep", "Dust desks", "Empty bins", "Clean the board"], "toilet": ["Scrub toilets", "Mop floor", "Refill water", "Disinfect"],
                "hostel": ["Sweep", "Mop", "Beds made", "Lockers tidy", "Empty bins"], "compound": ["Pick litter", "Sweep paths", "Clear gutters"],
                "office": ["Sweep", "Dust", "Empty bins"], "hall": ["Sweep", "Arrange chairs", "Dust"], "kitchen": ["Wash floor", "Clean tables", "Empty bins"],
                "lab": ["Wipe benches", "Sweep", "Sinks clean"], "other": ["Sweep", "Tidy"]}
FACILITY_KIND = {"classroom": "classroom", "laboratory": "lab", "ict_lab": "lab", "library": "office", "hall": "hall", "sick_bay": "office",
                 "kitchen": "kitchen", "dining_hall": "kitchen", "staff_room": "office", "office": "office", "chapel_mosque": "hall"}


@router.get("/cleaning/meta")
def meta(user: User = Depends(current_user)):
    return {"kinds": KINDS, "shifts": SHIFTS, "checklists": DEFAULT_LIST}


def manager(db: Session, user: User, school: School, level: str | None = None) -> bool:
    """Runs cleaning: the maintenance team's leads, or anyone who may run operations."""
    if runs(user, school, "operations", level):
        return True
    lead = db.scalar(select(DeskMember.id).where(DeskMember.school_id == school.id, DeskMember.desk == "maintenance",
                                                 DeskMember.user_id == user.id, DeskMember.lead.is_(True), DeskMember.removed.is_(False)))
    return bool(lead) and not (level == "change" and rights.acting(user))


def need_manager(db: Session, user: User, school_id: uuid.UUID) -> School:
    s = school_for(db, user, school_id)
    if not manager(db, user, s):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the people who run cleaning can do this")
    return s


def house_parent(user: User, school: School) -> bool:
    return any(m.role == Role.house_parent and m.school_id == school.id for m in user.memberships)


def area_out(a: CleanArea, duties: list[CleanDuty], nm: Names, places: dict) -> dict:
    return {"id": str(a.id), "name": a.name, "kind": a.kind, "kind_label": KINDS.get(a.kind, KINDS["other"])["label"],
            "icon": KINDS.get(a.kind, KINDS["other"])["icon"], "days": a.days, "shift": a.shift, "checklist": a.checklist,
            "facility_id": str(a.facility_id) if a.facility_id else None, "hostel_id": str(a.hostel_id) if a.hostel_id else None,
            "place": places.get(a.facility_id) or places.get(a.hostel_id),
            "duties": [{"weekday": d.weekday, "user_id": str(d.user_id) if d.user_id else None, "name": nm.name(d.user_id) if d.user_id else None,
                        "team": d.team} for d in duties if d.area_id == a.id]}


def places_of(db: Session, school_id: uuid.UUID) -> dict:
    out = {f.id: f.name for f in db.scalars(select(Facility).join(Branch, Branch.id == Facility.branch_id).where(Branch.school_id == school_id))}
    out |= {h.id: h.name for h in db.scalars(select(Hostel).join(Branch, Branch.id == Hostel.branch_id).where(Branch.school_id == school_id))}
    return out


# ---------- Areas ----------

class AreaIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    name: str = Field(min_length=2, max_length=120)
    kind: str = "other"
    facility_id: uuid.UUID | None = None
    hostel_id: uuid.UUID | None = None
    days: list[int] = Field(default_factory=lambda: [0, 1, 2, 3, 4])
    shift: str = Field(default="morning", pattern="^(morning|afternoon|evening)$")
    checklist: list[str] = Field(default_factory=list, max_length=15)


def check_area(db: Session, school_id: uuid.UUID, data: AreaIn) -> None:
    if data.kind not in KINDS:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Choose a kind of place")
    if not data.days or any(d < 0 or d > 6 for d in data.days):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Choose the days it is cleaned")
    places = places_of(db, school_id)
    for x in (data.facility_id, data.hostel_id):
        if x and x not in places:
            raise not_found("Place")


@router.get("/schools/{school_id}/cleaning/areas")
def areas(school_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    need_manager(db, user, school_id)
    nm = Names(db, school_id)
    duties = list(db.scalars(select(CleanDuty).where(CleanDuty.school_id == school_id)))
    places = places_of(db, school_id)
    rows = db.scalars(select(CleanArea).where(CleanArea.school_id == school_id, CleanArea.active.is_(True)).order_by(CleanArea.kind, CleanArea.name))
    return [area_out(a, duties, nm, places) for a in rows]


@router.post("/schools/{school_id}/cleaning/areas", status_code=201)
def add_area(school_id: uuid.UUID, data: AreaIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    need_manager(db, user, school_id)
    check_area(db, school_id, data)
    body = data.model_dump()
    body["checklist"] = [x for x in body["checklist"] if x] or DEFAULT_LIST.get(data.kind, DEFAULT_LIST["other"])
    body["days"] = sorted(set(data.days))
    db.add(CleanArea(school_id=school_id, active=True, **body))
    db.commit()
    return areas(school_id, user, db)


@router.post("/schools/{school_id}/cleaning/areas/suggest")
def suggest(school_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Make a cleaning area for every classroom, lab, hall, office and hostel not yet on the rota, plus toilets and the compound."""
    need_manager(db, user, school_id)
    have = {(a.facility_id, a.hostel_id, a.name.lower()) for a in db.scalars(select(CleanArea).where(CleanArea.school_id == school_id))}
    names = {n for _, _, n in have}
    made = 0
    for f in db.scalars(select(Facility).join(Branch, Branch.id == Facility.branch_id).where(Branch.school_id == school_id)):
        kind = FACILITY_KIND.get(f.kind.value)
        if kind and not any(h[0] == f.id for h in have):
            db.add(CleanArea(school_id=school_id, name=f.name, kind=kind, facility_id=f.id, days=[0, 1, 2, 3, 4], shift="morning",
                             checklist=DEFAULT_LIST[kind], active=True))
            made += 1
    for h in db.scalars(select(Hostel).join(Branch, Branch.id == Hostel.branch_id).where(Branch.school_id == school_id)):
        if not any(x[1] == h.id for x in have):
            db.add(CleanArea(school_id=school_id, name=h.name, kind="hostel", hostel_id=h.id, days=[0, 1, 2, 3, 4, 5, 6], shift="morning",
                             checklist=DEFAULT_LIST["hostel"], active=True))
            made += 1
    for name, kind, days in (("Toilets", "toilet", [0, 1, 2, 3, 4, 5, 6]), ("Compound and grounds", "compound", [0, 2, 4])):
        if name.lower() not in names:
            db.add(CleanArea(school_id=school_id, name=name, kind=kind, days=days, shift="afternoon" if kind == "compound" else "morning",
                             checklist=DEFAULT_LIST[kind], active=True))
            made += 1
    db.commit()
    return {"added": made, "areas": areas(school_id, user, db)}


def get_area(db: Session, area_id: uuid.UUID) -> CleanArea:
    a = db.get(CleanArea, area_id)
    if not a or not a.active:
        raise not_found("Area")
    return a


@router.put("/cleaning/areas/{area_id}")
def edit_area(area_id: uuid.UUID, data: AreaIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    a = get_area(db, area_id)
    need_manager(db, user, a.school_id)
    check_area(db, a.school_id, data)
    for k, v in data.model_dump().items():
        setattr(a, k, sorted(set(v)) if k == "days" else v)
    db.commit()
    return areas(a.school_id, user, db)


@router.delete("/cleaning/areas/{area_id}", status_code=204)
def remove_area(area_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    a = get_area(db, area_id)
    need_manager(db, user, a.school_id)
    a.active = False
    db.commit()
    return Response(status_code=204)


class DutyIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    weekday: int = Field(ge=0, le=6)
    user_id: uuid.UUID | None = None
    team: str | None = Field(default=None, max_length=100)


class DutiesIn(BaseModel):
    duties: list[DutyIn] = Field(max_length=60)


@router.put("/cleaning/areas/{area_id}/duties")
def set_duties(area_id: uuid.UUID, data: DutiesIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    a = get_area(db, area_id)
    need_manager(db, user, a.school_id)
    ids = staff_ids(db, a.school_id)
    for d in data.duties:
        if not (d.user_id or d.team):
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Choose a cleaner or name a team")
        if d.user_id and d.user_id not in ids:
            raise not_found("Staff member")
    for old in db.scalars(select(CleanDuty).where(CleanDuty.area_id == a.id)):
        db.delete(old)
    db.flush()
    for d in data.duties:
        db.add(CleanDuty(school_id=a.school_id, area_id=a.id, weekday=d.weekday, user_id=d.user_id, team=d.team or None))
    db.commit()
    return areas(a.school_id, user, db)


class CopyDayIn(BaseModel):
    from_day: int = Field(ge=0, le=6)
    to_days: list[int] = Field(min_length=1, max_length=6)


@router.post("/schools/{school_id}/cleaning/copy-day")
def copy_day(school_id: uuid.UUID, data: CopyDayIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Use one day's rota for other days (Monday's cleaners on Tuesday to Friday...)."""
    need_manager(db, user, school_id)
    src = list(db.scalars(select(CleanDuty).where(CleanDuty.school_id == school_id, CleanDuty.weekday == data.from_day)))
    for wd in set(data.to_days) - {data.from_day}:
        for old in db.scalars(select(CleanDuty).where(CleanDuty.school_id == school_id, CleanDuty.weekday == wd)):
            db.delete(old)
        db.flush()
        for d in src:
            db.add(CleanDuty(school_id=school_id, area_id=d.area_id, weekday=wd, user_id=d.user_id, team=d.team))
    db.commit()
    return areas(school_id, user, db)


# ---------- The day ----------

def log_out(l: CleanLog | None, nm: Names) -> dict | None:
    if not l:
        return None
    return {"done_at": l.done_at.isoformat() if l.done_at else None, "done_by": nm.name(l.done_by_id), "ticked": l.ticked, "photo": l.photo,
            "score": l.score, "inspected_by": nm.name(l.inspected_by_id), "comment": l.comment}


def due_today(db: Session, school_id: uuid.UUID, day: date) -> list[CleanArea]:
    wd = day.weekday()
    return [a for a in db.scalars(select(CleanArea).where(CleanArea.school_id == school_id, CleanArea.active.is_(True)).order_by(CleanArea.shift, CleanArea.name))
            if wd in (a.days or [])]


@router.get("/schools/{school_id}/cleaning/day")
def the_day(school_id: uuid.UUID, on: date | None = Query(None, alias="date"), user: User = Depends(current_user), db: Session = Depends(get_db)):
    school = school_for(db, user, school_id)
    is_mgr = manager(db, user, school)
    day = on or now_wat().date()
    nm = Names(db, school_id)
    places = places_of(db, school_id)
    todo = due_today(db, school_id, day)
    duties = list(db.scalars(select(CleanDuty).where(CleanDuty.school_id == school_id, CleanDuty.weekday == day.weekday())))
    mine_ids = {d.area_id for d in duties if d.user_id == user.id}
    hp = house_parent(user, school)
    if not is_mgr:
        todo = [a for a in todo if a.id in mine_ids or (hp and a.kind == "hostel")]
        if not todo and not desk_members(db, school_id, "maintenance") & {user.id}:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "You have no cleaning on the rota")
    logs = {l.area_id: l for l in db.scalars(select(CleanLog).where(CleanLog.school_id == school_id, CleanLog.on_date == day))}
    rows = []
    for a in todo:
        rows.append({**area_out(a, duties, nm, places), "log": log_out(logs.get(a.id), nm), "mine": a.id in mine_ids,
                     "can_tick": not rights.acting(user) and (a.id in mine_ids or manager(db, user, school, "change")),
                     "can_inspect": not rights.acting(user) and (manager(db, user, school, "change") or (hp and a.kind == "hostel"))})
    done = sum(1 for r in rows if r["log"] and r["log"]["done_at"])
    checked = [r["log"]["score"] for r in rows if r["log"] and r["log"]["score"]]
    return {"date": day.isoformat(), "areas": rows, "done": done, "total": len(rows), "inspected": len(checked),
            "average": round(mean(checked), 1) if checked else None, "manager": is_mgr,
            "insights": insights(db, school_id) if is_mgr and day == now_wat().date() else []}


class TickIn(BaseModel):
    on_date: date
    ticked: list[str] = Field(default_factory=list, max_length=20)
    photo: str | None = Field(default=None, max_length=400_000)


@router.put("/cleaning/areas/{area_id}/done")
def mark_done(area_id: uuid.UUID, data: TickIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    a = get_area(db, area_id)
    school = school_for(db, user, a.school_id)
    mine = db.scalar(select(CleanDuty.id).where(CleanDuty.area_id == a.id, CleanDuty.weekday == data.on_date.weekday(), CleanDuty.user_id == user.id))
    if not (mine or manager(db, user, school, "change")):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This area isn't on your rota today")
    if data.on_date > now_wat().date():
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "That day hasn't come yet")
    l = db.scalar(select(CleanLog).where(CleanLog.area_id == a.id, CleanLog.on_date == data.on_date))
    if not l:
        l = CleanLog(school_id=a.school_id, area_id=a.id, on_date=data.on_date)
        db.add(l)
    l.ticked, l.done_by_id, l.done_at = data.ticked, user.id, datetime.now(timezone.utc)
    if data.photo:
        l.photo = data.photo
    db.commit()
    return log_out(l, Names(db, a.school_id))


class InspectIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    on_date: date
    score: int = Field(ge=1, le=5)
    comment: str | None = Field(default=None, max_length=300)


@router.put("/cleaning/areas/{area_id}/inspect")
def inspect(area_id: uuid.UUID, data: InspectIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    a = get_area(db, area_id)
    school = school_for(db, user, a.school_id)
    if not (manager(db, user, school, "change") or (house_parent(user, school) and a.kind == "hostel")) or rights.acting(user):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only a supervisor can inspect")
    l = db.scalar(select(CleanLog).where(CleanLog.area_id == a.id, CleanLog.on_date == data.on_date))
    if not l:
        l = CleanLog(school_id=a.school_id, area_id=a.id, on_date=data.on_date, ticked=[])
        db.add(l)
    l.score, l.comment, l.inspected_by_id, l.inspected_at = data.score, data.comment, user.id, datetime.now(timezone.utc)
    ticket = None
    if data.score <= 2:
        # Not good enough: a job goes to the maintenance and cleaning team to put it right.
        n = (db.scalar(select(func.max(Ticket.number)).where(Ticket.school_id == a.school_id)) or 0) + 1
        ticket = Ticket(school_id=a.school_id, number=n, desk="maintenance", category="cleaning", title=f"Clean again: {a.name}",
                        details=f"Inspection gave {data.score} of 5. {data.comment or ''}".strip(), location=a.name, facility_id=a.facility_id,
                        priority="normal", status="new", raised_by_id=user.id, due_on=data.on_date + timedelta(days=1), comments=[])
        db.add(ticket)
    db.commit()
    return {**log_out(l, Names(db, a.school_id)), "ticket": ticket.number if ticket else None}


# ---------- League and insights ----------

def stats(db: Session, school_id: uuid.UUID, days: int = 14) -> dict:
    end = now_wat().date()
    start = end - timedelta(days=days - 1)
    areas_ = list(db.scalars(select(CleanArea).where(CleanArea.school_id == school_id, CleanArea.active.is_(True))))
    logs = list(db.scalars(select(CleanLog).where(CleanLog.school_id == school_id, CleanLog.on_date >= start, CleanLog.on_date <= end)))
    by_area = defaultdict(list)
    for l in logs:
        by_area[l.area_id].append(l)
    duties = list(db.scalars(select(CleanDuty).where(CleanDuty.school_id == school_id)))
    out = []
    for a in areas_:
        due = sum(1 for i in range(days) if (start + timedelta(days=i)).weekday() in (a.days or []) and start + timedelta(days=i) < end) or 0
        done = sum(1 for l in by_area[a.id] if l.done_at and l.on_date < end)
        scores = [l.score for l in by_area[a.id] if l.score]
        out.append({"id": str(a.id), "name": a.name, "kind": a.kind, "hostel_id": str(a.hostel_id) if a.hostel_id else None,
                    "due": due, "done": done, "rate": round(100 * done / due) if due else None,
                    "score": round(mean(scores), 1) if scores else None, "inspections": len(scores)})
    people = defaultdict(lambda: {"due": 0, "done": 0})
    for d in duties:
        if not d.user_id:
            continue
        a = next((x for x in areas_ if x.id == d.area_id), None)
        if not a:
            continue
        for i in range(days - 1):
            day = start + timedelta(days=i)
            if day.weekday() == d.weekday and day.weekday() in (a.days or []):
                people[d.user_id]["due"] += 1
                if any(l.on_date == day and l.done_at for l in by_area[a.id]):
                    people[d.user_id]["done"] += 1
    return {"areas": out, "people": people, "start": start, "end": end}


def insights(db: Session, school_id: uuid.UUID) -> list[dict]:
    s = stats(db, school_id)
    tips: list[dict] = []
    if not s["areas"]:
        return [{"kind": "tip", "icon": "sparkle", "text": "No cleaning areas yet. Press “Add from Facilities” to make one for every room and hostel."}]
    unassigned = db.scalar(select(func.count()).select_from(CleanArea).where(CleanArea.school_id == school_id, CleanArea.active.is_(True),
                                                                            ~CleanArea.id.in_(select(CleanDuty.area_id)))) or 0
    if unassigned:
        tips.append({"kind": "alert", "icon": "users", "text": f"{unassigned} area{'s have' if unassigned > 1 else ' has'} nobody on the rota."})
    missed = sorted([a for a in s["areas"] if a["rate"] is not None and a["due"] >= 3 and a["rate"] < 70], key=lambda a: a["rate"])
    if missed:
        tips.append({"kind": "alert", "icon": "hourglass", "text": "Often not ticked as cleaned (last 2 weeks): " + ", ".join(f"{a['name']} ({a['rate']}%)" for a in missed[:3]) + "."})
    low = sorted([a for a in s["areas"] if a["score"] is not None and a["inspections"] >= 2 and a["score"] < 3], key=lambda a: a["score"])
    if low:
        tips.append({"kind": "grow", "icon": "target", "text": "Lowest inspection scores: " + ", ".join(f"{a['name']} ({a['score']}★)" for a in low[:3]) + ". Check they have the right materials."})
    best = sorted([a for a in s["areas"] if a["score"] is not None and a["inspections"] >= 2], key=lambda a: -a["score"])
    if best and best[0]["score"] >= 4:
        tips.append({"kind": "strength", "icon": "trophy", "text": f"Cleanest place this fortnight: {best[0]['name']} ({best[0]['score']}★)."})
    uninspected = [a for a in s["areas"] if a["due"] >= 5 and a["inspections"] == 0]
    if len(uninspected) >= 3:
        tips.append({"kind": "tip", "icon": "eye", "text": f"{len(uninspected)} areas haven't been inspected in 2 weeks. A quick walk-round with stars keeps standards up."})
    nm = Names(db, school_id)
    good = [(nm.name(u), round(100 * p["done"] / p["due"])) for u, p in s["people"].items() if p["due"] >= 5]
    if good:
        top = max(good, key=lambda x: x[1])
        if top[1] >= 90:
            tips.append({"kind": "strength", "icon": "star", "text": f"{top[0]} ticked off {top[1]}% of their cleaning in the last 2 weeks."})
    return tips


@router.get("/schools/{school_id}/cleaning/league")
def league(school_id: uuid.UUID, days: int = Query(14, ge=7, le=90), user: User = Depends(current_user), db: Session = Depends(get_db)):
    need_manager(db, user, school_id)
    s = stats(db, school_id, days)
    places = places_of(db, school_id)
    hostels = defaultdict(list)
    for a in s["areas"]:
        if a["hostel_id"] and a["score"] is not None:
            hostels[a["hostel_id"]].append(a["score"])
    nm = Names(db, school_id)
    return {"from": s["start"].isoformat(), "to": s["end"].isoformat(),
            "areas": sorted(s["areas"], key=lambda a: (-(a["score"] or 0), -(a["rate"] or 0))),
            "hostels": sorted([{"id": h, "name": places.get(uuid.UUID(h)), "score": round(mean(v), 2)} for h, v in hostels.items()], key=lambda x: -x["score"]),
            "people": sorted([{"name": nm.name(u), "due": p["due"], "done": p["done"], "rate": round(100 * p["done"] / p["due"]) if p["due"] else None}
                              for u, p in s["people"].items()], key=lambda x: -(x["rate"] or 0)),
            "insights": insights(db, school_id)}


@router.get("/me/schools/{school_id}/cleaning")
def my_cleaning(school_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    school = school_for(db, user, school_id)
    day = now_wat().date()
    mine = {d.area_id for d in db.scalars(select(CleanDuty).where(CleanDuty.school_id == school_id, CleanDuty.weekday == day.weekday(), CleanDuty.user_id == user.id))}
    todo = [a for a in due_today(db, school_id, day) if a.id in mine]
    logs = {l.area_id: l for l in db.scalars(select(CleanLog).where(CleanLog.school_id == school_id, CleanLog.on_date == day))}
    return {"date": day.isoformat(), "areas": [{"id": str(a.id), "name": a.name, "kind": a.kind, "shift": a.shift, "checklist": a.checklist,
                                                "done": bool(logs.get(a.id) and logs[a.id].done_at), "score": logs[a.id].score if a.id in logs else None}
                                               for a in todo],
            "inspects": house_parent(user, school) or manager(db, user, school)}


@router.get("/schools/{school_id}/cleaning/staff")
def cleaning_staff(school_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Staff to put on the rota (cleaners and porters first)."""
    need_manager(db, user, school_id)
    nm = Names(db, school_id)
    rows = [nm.card(u) for u in staff_ids(db, school_id)]
    return sorted([r for r in rows if r], key=lambda r: (not any(w in (r["job_title"] or "").lower() for w in ("clean", "porter", "labour", "cleaner")), r["name"] or ""))
