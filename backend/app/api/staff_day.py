"""The staff working day: signing in and out (three ways), leave, duty rota and lesson notes.

Signing in:
- scan: a phone or tablet at the gate runs the kiosk page with the school's secret kiosk link and scans ID cards;
- self: a staff member taps "I'm in" on their own phone (if the school allows it; optionally only near the school);
- admin: the principal, a vice principal or the IT team marks people on the attendance board.
Times are Nigerian time (WAT).
"""
import math
import secrets
import uuid
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Response, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session

from app.api.access import not_found
from app.core import rights
from app.api.deps import current_user, managed_school_ids, owned_group_ids
from app.api.electives import leads_subject
from app.api.staff import STAFF_ROLES
from app.core.db import get_db
from app.models import (
    ClassSubject, Department, DutyAssignment, LeaveRequest, LessonNote, Membership, Role, School, SchoolClass, StaffAttendance,
    StaffDaySettings, StaffProfile, Subject, TeachingGroup, Unit, User,
)

router = APIRouter(prefix="/api", tags=["staff day"])
WAT = ZoneInfo("Africa/Lagos")

LEAVE_KINDS = {"sick": "Sick leave", "casual": "Casual leave", "annual": "Annual leave", "maternity": "Maternity leave",
               "paternity": "Paternity leave", "study": "Study leave", "compassionate": "Compassionate leave", "other": "Other"}
DUTIES = ["Teacher on duty", "Assembly", "Morning prep", "Evening prep", "Night duty", "Dining hall", "Weekend duty",
          "Gate", "Sick bay visit", "Sports", "Sunday service / Mass", "Exam invigilation"]


def now_wat() -> datetime:
    return datetime.now(WAT)


# ---------- Who may do what ----------

def runs(user: User, school: School, area: str | None = None, level: str | None = None) -> bool:
    """May see (when reading) or change (when saving) this page's area of the school. See app.core.rights."""
    return rights.may(user, school, area, level)


def staff_ids(db: Session, school_id: uuid.UUID) -> set[uuid.UUID]:
    return set(db.scalars(select(Membership.user_id).where(Membership.school_id == school_id, Membership.role.in_(STAFF_ROLES))))


def school_for(db: Session, user: User, school_id: uuid.UUID, manage: bool = False) -> School:
    s = db.get(School, school_id)
    if not s:
        raise not_found("School")
    if runs(user, s):
        return s
    if not manage and user.id in staff_ids(db, school_id):
        return s
    if manage and rights.any_area(user, s):
        from app.api.access import check
        check(user, s)
    raise not_found("School")


def settings_for(db: Session, school_id: uuid.UUID) -> StaffDaySettings:
    st = db.scalar(select(StaffDaySettings).where(StaffDaySettings.school_id == school_id))
    if not st:
        st = StaffDaySettings(school_id=school_id, kiosk_token=secrets.token_urlsafe(24), day_starts=time(7, 30),
                              late_after=time(7, 45), day_ends=time(16, 0), work_days=[0, 1, 2, 3, 4], allow_self=True, radius_m=300)
        db.add(st)
        db.flush()
    return st


def name_of(db: Session, school_id: uuid.UUID, user_id: uuid.UUID | None) -> str | None:
    if not user_id:
        return None
    u = db.get(User, user_id)
    p = db.scalar(select(StaffProfile).where(StaffProfile.school_id == school_id, StaffProfile.user_id == user_id))
    return " ".join(x for x in [p.title if p else None, u.full_name if u else None] if x)


# ---------- Settings ----------

class SettingsOut(BaseModel):
    day_starts: time
    late_after: time
    day_ends: time
    work_days: list[int]
    allow_self: bool
    latitude: float | None
    longitude: float | None
    radius_m: int
    kiosk_token: str | None   # only for the people who run the school


class SettingsIn(BaseModel):
    day_starts: time
    late_after: time
    day_ends: time
    work_days: list[int] = Field(min_length=1)
    allow_self: bool = True
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    radius_m: int = Field(default=300, ge=50, le=5000)


def settings_out(st: StaffDaySettings, show_token: bool) -> SettingsOut:
    return SettingsOut(day_starts=st.day_starts, late_after=st.late_after, day_ends=st.day_ends, work_days=st.work_days,
                       allow_self=st.allow_self, latitude=st.latitude, longitude=st.longitude, radius_m=st.radius_m,
                       kiosk_token=st.kiosk_token if show_token else None)


@router.get("/schools/{school_id}/staff-day/settings", response_model=SettingsOut)
def get_settings(school_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    s = school_for(db, user, school_id)
    st = settings_for(db, school_id)
    db.commit()
    return settings_out(st, runs(user, s))


@router.put("/schools/{school_id}/staff-day/settings", response_model=SettingsOut)
def put_settings(school_id: uuid.UUID, data: SettingsIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    school_for(db, user, school_id, manage=True)
    if not (data.day_starts <= data.late_after < data.day_ends):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Times should go: day starts, then late after, then day ends")
    if any(d < 0 or d > 6 for d in data.work_days):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Work days are 0 (Monday) to 6 (Sunday)")
    st = settings_for(db, school_id)
    for k, v in data.model_dump().items():
        setattr(st, k, v)
    db.commit()
    return settings_out(st, True)


@router.post("/schools/{school_id}/staff-day/new-kiosk-link", response_model=SettingsOut)
def new_kiosk_link(school_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Makes a fresh kiosk link; the old one stops working (e.g. if a kiosk phone is lost)."""
    school_for(db, user, school_id, manage=True)
    st = settings_for(db, school_id)
    st.kiosk_token = secrets.token_urlsafe(24)
    db.commit()
    return settings_out(st, True)


# ---------- Signing in and out ----------

def on_leave(db: Session, school_id: uuid.UUID, user_id: uuid.UUID, day: date) -> LeaveRequest | None:
    return db.scalar(select(LeaveRequest).where(LeaveRequest.school_id == school_id, LeaveRequest.user_id == user_id,
                                                LeaveRequest.status == "approved", LeaveRequest.starts_on <= day, LeaveRequest.ends_on >= day))


class Stamp(BaseModel):
    user_id: uuid.UUID
    name: str
    photo: str | None
    job_title: str | None
    action: str              # in, out, already
    status: str
    time_in: datetime | None
    time_out: datetime | None
    message: str


def stamp(db: Session, school_id: uuid.UUID, user_id: uuid.UUID, method: str, by: uuid.UUID | None) -> Stamp:
    """Signs a person in, or out if they are already in (and at least 5 minutes have passed)."""
    st = settings_for(db, school_id)
    now = now_wat()
    today = now.date()
    row = db.scalar(select(StaffAttendance).where(StaffAttendance.school_id == school_id, StaffAttendance.user_id == user_id,
                                                  StaffAttendance.on_date == today))
    p = db.scalar(select(StaffProfile).where(StaffProfile.school_id == school_id, StaffProfile.user_id == user_id))
    name = name_of(db, school_id, user_id) or "Staff"
    u = db.get(User, user_id)
    first = (u.full_name.split() or ["there"])[0]
    if not row or not row.time_in:
        late = now.time() > st.late_after
        if not row:
            row = StaffAttendance(school_id=school_id, user_id=user_id, on_date=today)
            db.add(row)
        row.status, row.time_in, row.method_in, row.marked_by_id = ("late" if late else "present"), now, method, by
        action = "in"
        msg = f"Welcome, {first}. Signed in at {now:%H:%M}" + (" (late)." if late else ".")
    elif not row.time_out and (now - row.time_in.astimezone(WAT)) >= timedelta(minutes=5):
        row.time_out, row.method_out = now, method
        action = "out"
        msg = f"Goodbye, {first}. Signed out at {now:%H:%M}."
    else:
        action = "already"
        msg = f"{first}, you signed in at {row.time_in.astimezone(WAT):%H:%M}" + (f" and out at {row.time_out.astimezone(WAT):%H:%M}." if row.time_out else ".")
    db.commit()
    return Stamp(user_id=user_id, name=name, photo=p.photo if p else None, job_title=p.job_title if p else None,
                 action=action, status=row.status, time_in=row.time_in, time_out=row.time_out, message=msg)


class ScanIn(BaseModel):
    code: str = Field(max_length=200)   # the QR on the ID card, or a staff number typed in


@router.post("/kiosk/{school_id}/scan", response_model=Stamp)
def kiosk_scan(school_id: uuid.UUID, data: ScanIn, x_kiosk_token: str = Header(...), db: Session = Depends(get_db)):
    """Used by the gate device. It has no login; the secret kiosk link is its key."""
    st = db.scalar(select(StaffDaySettings).where(StaffDaySettings.school_id == school_id))
    if not st or not secrets.compare_digest(st.kiosk_token, x_kiosk_token):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This kiosk link is not valid any more. Ask the school for the new one.")
    code = data.code.strip()
    user_id = None
    if code.startswith("SP1:S:"):
        parts = code.split(":")
        if len(parts) == 4 and parts[2] == school_id.hex[:8]:
            try:
                user_id = uuid.UUID(parts[3])
            except ValueError:
                user_id = None
        if not user_id:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "That card is for a different school")
    else:
        p = db.scalar(select(StaffProfile).where(StaffProfile.school_id == school_id, StaffProfile.staff_no.ilike(code)))
        user_id = p.user_id if p else None
    if not user_id or user_id not in staff_ids(db, school_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Card or staff number not recognised")
    if not db.get(User, user_id).is_active:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This person's login is switched off. See the office.")
    return stamp(db, school_id, user_id, "scan", None)


@router.get("/kiosk/{school_id}", response_model=dict)
def kiosk_info(school_id: uuid.UUID, x_kiosk_token: str = Header(...), db: Session = Depends(get_db)):
    st = db.scalar(select(StaffDaySettings).where(StaffDaySettings.school_id == school_id))
    if not st or not secrets.compare_digest(st.kiosk_token, x_kiosk_token):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This kiosk link is not valid any more. Ask the school for the new one.")
    s = db.get(School, school_id)
    today = now_wat().date()
    n_in = len(list(db.scalars(select(StaffAttendance.id).where(StaffAttendance.school_id == school_id, StaffAttendance.on_date == today,
                                                                StaffAttendance.time_in.is_not(None)))))
    return {"school_name": s.name, "logo": s.logo, "colour": s.colour, "motto": s.motto, "signed_in": n_in,
            "staff": len(staff_ids(db, school_id)), "late_after": st.late_after.strftime("%H:%M")}


class SelfIn(BaseModel):
    latitude: float | None = None
    longitude: float | None = None


def metres(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371000
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = math.radians(lat2 - lat1), math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


@router.post("/me/schools/{school_id}/sign", response_model=Stamp)
def self_sign(school_id: uuid.UUID, data: SelfIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    if user.id not in staff_ids(db, school_id):
        raise not_found("School")
    st = settings_for(db, school_id)
    if not st.allow_self:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This school signs staff in at the gate. Scan your ID card there.")
    if st.latitude is not None and st.longitude is not None:
        if data.latitude is None or data.longitude is None:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Allow location on your phone so we can check you are at school")
        d = metres(st.latitude, st.longitude, data.latitude, data.longitude)
        if d > st.radius_m:
            raise HTTPException(status.HTTP_403_FORBIDDEN, f"You seem to be {round(d / 1000, 1)} km from school. Sign in when you get there.")
    return stamp(db, school_id, user.id, "self", user.id)


# ---------- The attendance board ----------

class BoardRow(BaseModel):
    user_id: uuid.UUID
    name: str
    job_title: str | None
    department_name: str | None
    photo: str | None
    status: str           # present, late, absent, excused, leave, not_in (not signed in yet), off (not a work day)
    time_in: datetime | None
    time_out: datetime | None
    method_in: str | None
    note: str | None
    leave_kind: str | None


class Board(BaseModel):
    on_date: date
    work_day: bool
    day_over: bool
    counts: dict[str, int]
    rows: list[BoardRow]


@router.get("/schools/{school_id}/staff-attendance", response_model=Board)
def board(school_id: uuid.UUID, on_date: date | None = Query(default=None, alias="date"),
          user: User = Depends(current_user), db: Session = Depends(get_db)):
    school_for(db, user, school_id, manage=True)
    st = settings_for(db, school_id)
    now = now_wat()
    day = on_date or now.date()
    work = day.weekday() in st.work_days
    day_over = day < now.date() or (day == now.date() and now.time() > st.day_ends)
    ids = staff_ids(db, school_id)
    rows = {r.user_id: r for r in db.scalars(select(StaffAttendance).where(StaffAttendance.school_id == school_id, StaffAttendance.on_date == day))}
    leaves = {l.user_id: l for l in db.scalars(select(LeaveRequest).where(
        LeaveRequest.school_id == school_id, LeaveRequest.status == "approved", LeaveRequest.starts_on <= day, LeaveRequest.ends_on >= day))}
    profiles = {p.user_id: p for p in db.scalars(select(StaffProfile).where(StaffProfile.school_id == school_id))}
    out = []
    for uid in ids:
        r, p, lv = rows.get(uid), profiles.get(uid), leaves.get(uid)
        if r:
            s = r.status
        elif lv:
            s = "leave"
        elif not work:
            s = "off"
        else:
            s = "absent" if day_over else "not_in"
        out.append(BoardRow(user_id=uid, name=name_of(db, school_id, uid) or "", job_title=p.job_title if p else None,
                            department_name=p.department.name if p and p.department else None, photo=p.photo if p else None,
                            status=s, time_in=r.time_in if r else None, time_out=r.time_out if r else None,
                            method_in=r.method_in if r else None, note=r.note if r else None,
                            leave_kind=LEAVE_KINDS.get(lv.kind) if lv else None))
    order = {"late": 0, "not_in": 1, "absent": 2, "present": 3, "excused": 4, "leave": 5, "off": 6}
    out.sort(key=lambda x: (order.get(x.status, 9), x.name.lower()))
    counts: dict[str, int] = {}
    for x in out:
        counts[x.status] = counts.get(x.status, 0) + 1
    db.commit()
    return Board(on_date=day, work_day=work, day_over=day_over, counts=counts, rows=out)


class MarkIn(BaseModel):
    user_id: uuid.UUID
    on_date: date
    status: str = Field(pattern="^(present|late|absent|excused|clear)$")
    time_in: time | None = None
    note: str | None = Field(default=None, max_length=200)


@router.post("/schools/{school_id}/staff-attendance/mark", response_model=Board)
def mark(school_id: uuid.UUID, data: MarkIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    school_for(db, user, school_id, manage=True)
    if data.user_id not in staff_ids(db, school_id):
        raise not_found("Staff member")
    if data.on_date > now_wat().date():
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "You can't mark a day that hasn't come yet")
    row = db.scalar(select(StaffAttendance).where(StaffAttendance.school_id == school_id, StaffAttendance.user_id == data.user_id,
                                                  StaffAttendance.on_date == data.on_date))
    if data.status == "clear":
        if row:
            db.delete(row)
    else:
        if not row:
            row = StaffAttendance(school_id=school_id, user_id=data.user_id, on_date=data.on_date)
            db.add(row)
        row.status, row.method_in, row.marked_by_id, row.note = data.status, "admin", user.id, data.note
        if data.status in ("present", "late"):
            t = data.time_in or (row.time_in.astimezone(WAT).time() if row.time_in else now_wat().time().replace(second=0, microsecond=0))
            row.time_in = datetime.combine(data.on_date, t, WAT)
        else:
            row.time_in = row.time_out = None
    db.commit()
    return board(school_id, data.on_date, user, db)


class SummaryRow(BaseModel):
    user_id: uuid.UUID
    name: str
    job_title: str | None
    days: int
    present: int
    late: int
    absent: int
    leave: int
    average_in: str | None


@router.get("/schools/{school_id}/staff-attendance/summary", response_model=list[SummaryRow])
def summary(school_id: uuid.UUID, start: date = Query(alias="from"), end: date = Query(alias="to"),
            user: User = Depends(current_user), db: Session = Depends(get_db)):
    school_for(db, user, school_id, manage=True)
    st = settings_for(db, school_id)
    today = now_wat().date()
    end = min(end, today)
    days = [start + timedelta(days=i) for i in range((end - start).days + 1) if (start + timedelta(days=i)).weekday() in st.work_days]
    if len(days) > 400:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Choose at most about a year")
    rows = list(db.scalars(select(StaffAttendance).where(StaffAttendance.school_id == school_id, StaffAttendance.on_date >= start,
                                                         StaffAttendance.on_date <= end)))
    leaves = list(db.scalars(select(LeaveRequest).where(LeaveRequest.school_id == school_id, LeaveRequest.status == "approved",
                                                        LeaveRequest.starts_on <= end, LeaveRequest.ends_on >= start)))
    out = []
    for uid in staff_ids(db, school_id):
        mine = {r.on_date: r for r in rows if r.user_id == uid}
        lv = [l for l in leaves if l.user_id == uid]
        present = late = absent = leave = 0
        mins = []
        for d in days:
            r = mine.get(d)
            if r and r.status in ("present", "late"):
                present += 1
                late += r.status == "late"
                if r.time_in:
                    t = r.time_in.astimezone(WAT)
                    mins.append(t.hour * 60 + t.minute)
            elif any(l.starts_on <= d <= l.ends_on for l in lv) or (r and r.status == "excused"):
                leave += 1
            elif d < today or (r and r.status == "absent"):
                absent += 1
        avg = sum(mins) / len(mins) if mins else None
        p = db.scalar(select(StaffProfile).where(StaffProfile.school_id == school_id, StaffProfile.user_id == uid))
        out.append(SummaryRow(user_id=uid, name=name_of(db, school_id, uid) or "", job_title=p.job_title if p else None, days=len(days),
                              present=present, late=late, absent=absent, leave=leave,
                              average_in=f"{int(avg // 60):02d}:{int(avg % 60):02d}" if avg is not None else None))
    out.sort(key=lambda x: (-x.absent, -x.late, x.name))
    return out


class MyDay(BaseModel):
    on_date: date
    work_day: bool
    status: str
    time_in: datetime | None
    time_out: datetime | None
    allow_self: bool
    needs_location: bool
    late_after: time
    recent: list[dict]


@router.get("/me/schools/{school_id}/day", response_model=MyDay)
def my_day(school_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    if user.id not in staff_ids(db, school_id):
        raise not_found("School")
    st = settings_for(db, school_id)
    today = now_wat().date()
    rows = {r.on_date: r for r in db.scalars(select(StaffAttendance).where(
        StaffAttendance.school_id == school_id, StaffAttendance.user_id == user.id, StaffAttendance.on_date >= today - timedelta(days=30)))}
    r = rows.get(today)
    lv = on_leave(db, school_id, user.id, today)
    recent = []
    for i in range(1, 15):
        d = today - timedelta(days=i)
        if d.weekday() not in st.work_days:
            continue
        x = rows.get(d)
        recent.append({"date": d.isoformat(), "status": x.status if x else ("leave" if on_leave(db, school_id, user.id, d) else "absent"),
                       "time_in": x.time_in.astimezone(WAT).strftime("%H:%M") if x and x.time_in else None})
    db.commit()
    return MyDay(on_date=today, work_day=today.weekday() in st.work_days,
                 status=r.status if r else ("leave" if lv else "not_in"), time_in=r.time_in if r else None,
                 time_out=r.time_out if r else None, allow_self=st.allow_self,
                 needs_location=st.latitude is not None, late_after=st.late_after, recent=recent[:10])


# ---------- Leave ----------

class LeaveIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    kind: str
    starts_on: date
    ends_on: date
    reason: str | None = Field(default=None, max_length=500)
    user_id: uuid.UUID | None = None   # the people who run the school may record leave for someone


class LeaveOut(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    name: str
    kind: str
    kind_label: str
    starts_on: date
    ends_on: date
    days: int
    reason: str | None
    status: str
    decided_by: str | None
    decision_note: str | None
    cover_user_id: uuid.UUID | None
    cover_name: str | None
    created_at: datetime


def work_days_between(st: StaffDaySettings, a: date, b: date) -> int:
    return sum(1 for i in range((b - a).days + 1) if (a + timedelta(days=i)).weekday() in st.work_days)


def leave_out(db: Session, l: LeaveRequest) -> LeaveOut:
    st = settings_for(db, l.school_id)
    return LeaveOut(id=l.id, user_id=l.user_id, name=name_of(db, l.school_id, l.user_id) or "", kind=l.kind,
                    kind_label=LEAVE_KINDS.get(l.kind, l.kind), starts_on=l.starts_on, ends_on=l.ends_on,
                    days=work_days_between(st, l.starts_on, l.ends_on), reason=l.reason, status=l.status,
                    decided_by=name_of(db, l.school_id, l.decided_by_id), decision_note=l.decision_note,
                    cover_user_id=l.cover_user_id, cover_name=name_of(db, l.school_id, l.cover_user_id), created_at=l.created_at)


@router.post("/schools/{school_id}/leave", response_model=LeaveOut, status_code=201)
def request_leave(school_id: uuid.UUID, data: LeaveIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    s = school_for(db, user, school_id)
    who = data.user_id or user.id
    if who != user.id and not runs(user, s):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You can only ask for your own leave")
    if who not in staff_ids(db, school_id):
        raise not_found("Staff member")
    if data.kind not in LEAVE_KINDS:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Choose the kind of leave")
    if data.ends_on < data.starts_on:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Leave can't end before it starts")
    if (data.ends_on - data.starts_on).days > 200:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "That is longer than 200 days")
    clash = db.scalar(select(LeaveRequest).where(LeaveRequest.school_id == school_id, LeaveRequest.user_id == who,
                                                 LeaveRequest.status.in_(["pending", "approved"]),
                                                 LeaveRequest.starts_on <= data.ends_on, LeaveRequest.ends_on >= data.starts_on))
    if clash:
        raise HTTPException(status.HTTP_409_CONFLICT, "There is already leave asked for or approved on some of those days")
    l = LeaveRequest(school_id=school_id, user_id=who, kind=data.kind, starts_on=data.starts_on, ends_on=data.ends_on, reason=data.reason)
    if who != user.id:  # recorded by the office: approved straight away
        l.status, l.decided_by_id, l.decided_at = "approved", user.id, datetime.now(timezone.utc)
    db.add(l)
    db.commit()
    return leave_out(db, l)


@router.get("/schools/{school_id}/leave", response_model=list[LeaveOut])
def list_leave(school_id: uuid.UUID, mine: bool = False, user: User = Depends(current_user), db: Session = Depends(get_db)):
    s = school_for(db, user, school_id)
    q = select(LeaveRequest).where(LeaveRequest.school_id == school_id)
    if mine or not runs(user, s):
        q = q.where(LeaveRequest.user_id == user.id)
    rows = db.scalars(q.order_by(LeaveRequest.status != "pending", LeaveRequest.starts_on.desc()).limit(300))
    return [leave_out(db, l) for l in rows]


class DecisionIn(BaseModel):
    approve: bool
    note: str | None = Field(default=None, max_length=300)
    cover_user_id: uuid.UUID | None = None


@router.put("/leave/{leave_id}/decision", response_model=LeaveOut)
def decide(leave_id: uuid.UUID, data: DecisionIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    l = db.get(LeaveRequest, leave_id)
    if not l:
        raise not_found("Leave")
    school_for(db, user, l.school_id, manage=True)
    if l.user_id == user.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Someone else must decide your own leave")
    if l.status not in ("pending", "approved"):
        raise HTTPException(status.HTTP_409_CONFLICT, "This request is closed")
    if data.cover_user_id and data.cover_user_id not in staff_ids(db, l.school_id):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "The cover must be on the staff")
    l.status = "approved" if data.approve else "declined"
    l.decided_by_id, l.decided_at, l.decision_note, l.cover_user_id = user.id, datetime.now(timezone.utc), data.note, data.cover_user_id
    db.commit()
    return leave_out(db, l)


@router.put("/leave/{leave_id}/cancel", response_model=LeaveOut)
def cancel_leave(leave_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    l = db.get(LeaveRequest, leave_id)
    if not l:
        raise not_found("Leave")
    s = school_for(db, user, l.school_id)
    if l.user_id != user.id and not runs(user, s):
        raise not_found("Leave")
    if l.status not in ("pending", "approved"):
        raise HTTPException(status.HTTP_409_CONFLICT, "This request is already closed")
    l.status = "cancelled"
    db.commit()
    return leave_out(db, l)


# ---------- Duty rota ----------

class DutyIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    user_id: uuid.UUID
    duty: str = Field(min_length=2, max_length=80)
    on_date: date
    until: date | None = None      # repeat every work day up to this date
    note: str | None = Field(default=None, max_length=200)


class DutyOut(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    name: str
    duty: str
    on_date: date
    note: str | None


@router.get("/schools/{school_id}/duties", response_model=dict)
def list_duties(school_id: uuid.UUID, start: date = Query(alias="from"), end: date = Query(alias="to"),
                user: User = Depends(current_user), db: Session = Depends(get_db)):
    school_for(db, user, school_id)
    rows = db.scalars(select(DutyAssignment).where(DutyAssignment.school_id == school_id, DutyAssignment.on_date >= start,
                                                   DutyAssignment.on_date <= end).order_by(DutyAssignment.on_date, DutyAssignment.duty))
    names: dict = {}
    out = []
    for d in rows:
        if d.user_id not in names:
            names[d.user_id] = name_of(db, school_id, d.user_id) or ""
        out.append(DutyOut(id=d.id, user_id=d.user_id, name=names[d.user_id], duty=d.duty, on_date=d.on_date, note=d.note).model_dump(mode="json"))
    return {"duties": out, "kinds": DUTIES}


@router.post("/schools/{school_id}/duties", response_model=dict, status_code=201)
def add_duty(school_id: uuid.UUID, data: DutyIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    school_for(db, user, school_id, manage=True)
    if data.user_id not in staff_ids(db, school_id):
        raise not_found("Staff member")
    st = settings_for(db, school_id)
    end = data.until or data.on_date
    if end < data.on_date or (end - data.on_date).days > 120:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Repeat for at most 120 days, ending after it starts")
    made = 0
    for i in range((end - data.on_date).days + 1):
        d = data.on_date + timedelta(days=i)
        if data.until and d.weekday() not in st.work_days and data.duty != "Weekend duty":
            continue
        exists = db.scalar(select(DutyAssignment.id).where(DutyAssignment.school_id == school_id, DutyAssignment.user_id == data.user_id,
                                                           DutyAssignment.duty == data.duty, DutyAssignment.on_date == d))
        if not exists:
            db.add(DutyAssignment(school_id=school_id, user_id=data.user_id, duty=data.duty, on_date=d, note=data.note))
            made += 1
    db.commit()
    return {"added": made}


@router.delete("/duties/{duty_id}", status_code=204)
def delete_duty(duty_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    d = db.get(DutyAssignment, duty_id)
    if not d:
        raise not_found("Duty")
    school_for(db, user, d.school_id, manage=True)
    db.delete(d)
    db.commit()
    return Response(status_code=204)


# ---------- Lesson notes and schemes of work ----------

class NoteIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    kind: str = Field(default="note", pattern="^(note|scheme)$")
    subject_id: uuid.UUID
    level: str = Field(min_length=2, max_length=40)
    week_starting: date | None = None
    term_label: str | None = Field(default=None, max_length=40)
    topic: str = Field(min_length=2, max_length=200)
    objectives: str | None = Field(default=None, max_length=5000)
    content: str | None = Field(default=None, max_length=40000)
    submit: bool = False


class NoteOut(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    teacher: str
    kind: str
    subject_id: uuid.UUID
    subject_name: str
    level: str
    week_starting: date | None
    term_label: str | None
    topic: str
    objectives: str | None
    content: str | None
    status: str
    submitted_at: datetime | None
    reviewer: str | None
    reviewed_at: datetime | None
    review_note: str | None
    can_review: bool
    can_edit: bool


def may_review(db: Session, user: User, school: School, subject: Subject) -> bool:
    return runs(user, school) or leads_subject(db, user, subject)


def note_out(db: Session, user: User, n: LessonNote) -> NoteOut:
    s, school = db.get(Subject, n.subject_id), db.get(School, n.school_id)
    return NoteOut(id=n.id, user_id=n.user_id, teacher=name_of(db, n.school_id, n.user_id) or "", kind=n.kind, subject_id=n.subject_id,
                   subject_name=s.name, level=n.level, week_starting=n.week_starting, term_label=n.term_label, topic=n.topic,
                   objectives=n.objectives, content=n.content, status=n.status, submitted_at=n.submitted_at,
                   reviewer=name_of(db, n.school_id, n.reviewer_id), reviewed_at=n.reviewed_at, review_note=n.review_note,
                   can_review=n.user_id != user.id and n.status == "submitted" and may_review(db, user, school, s),
                   can_edit=n.user_id == user.id and n.status in ("draft", "returned"))


@router.get("/schools/{school_id}/my-subjects", response_model=list[dict])
def my_subjects(school_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Subjects and levels this teacher teaches, for the lesson-note form."""
    school_for(db, user, school_id)
    pairs = set()
    for slot in db.scalars(select(ClassSubject).join(SchoolClass, SchoolClass.id == ClassSubject.class_id).where(ClassSubject.teacher_user_id == user.id)):
        c = db.get(SchoolClass, slot.class_id)
        pairs.add((slot.subject_id, c.level))
    for g in db.scalars(select(TeachingGroup).where(TeachingGroup.teacher_user_id == user.id)):
        pairs.add((g.subject_id, g.level))
    out = [{"subject_id": str(sid), "subject_name": db.get(Subject, sid).name, "level": lv} for sid, lv in pairs
           if db.get(Subject, sid).school_id == school_id]
    return sorted(out, key=lambda x: (x["subject_name"], x["level"]))


@router.post("/schools/{school_id}/lesson-notes", response_model=NoteOut, status_code=201)
def add_note(school_id: uuid.UUID, data: NoteIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    school_for(db, user, school_id)
    s = db.get(Subject, data.subject_id)
    if not s or s.school_id != school_id:
        raise not_found("Subject")
    n = LessonNote(school_id=school_id, user_id=user.id, **data.model_dump(exclude={"submit"}))
    if data.submit:
        n.status, n.submitted_at = "submitted", datetime.now(timezone.utc)
    db.add(n)
    db.commit()
    return note_out(db, user, n)


@router.put("/lesson-notes/{note_id}", response_model=NoteOut)
def edit_note(note_id: uuid.UUID, data: NoteIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    n = db.get(LessonNote, note_id)
    if not n or n.user_id != user.id:
        raise not_found("Lesson note")
    if n.status not in ("draft", "returned"):
        raise HTTPException(status.HTTP_409_CONFLICT, "This note has been sent. Wait for it to be returned to change it.")
    for k, v in data.model_dump(exclude={"submit"}).items():
        setattr(n, k, v)
    if data.submit:
        n.status, n.submitted_at = "submitted", datetime.now(timezone.utc)
    db.commit()
    return note_out(db, user, n)


@router.delete("/lesson-notes/{note_id}", status_code=204)
def delete_note(note_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    n = db.get(LessonNote, note_id)
    if not n or n.user_id != user.id or n.status == "approved":
        raise not_found("Lesson note")
    db.delete(n)
    db.commit()
    return Response(status_code=204)


@router.get("/schools/{school_id}/lesson-notes", response_model=list[NoteOut])
def list_notes(school_id: uuid.UUID, view: str = Query("mine", pattern="^(mine|review|all)$"), status_: str | None = Query(None, alias="status"),
               user: User = Depends(current_user), db: Session = Depends(get_db)):
    s = school_for(db, user, school_id)
    q = select(LessonNote).where(LessonNote.school_id == school_id)
    if view == "mine":
        q = q.where(LessonNote.user_id == user.id)
    elif view == "review":
        if runs(user, s):
            q = q.where(LessonNote.user_id != user.id)
        else:
            depts = set(db.scalars(select(Department.id).where(Department.school_id == school_id, Department.head_user_id == user.id)))
            units = set(db.scalars(select(Unit.id).where(Unit.school_id == school_id, Unit.head_user_id == user.id)))
            if not depts and not units:
                return []
            subs = set(db.scalars(select(Subject.id).where(Subject.school_id == school_id, or_(
                Subject.department_id.in_(depts or {uuid.uuid4()}), Subject.unit_id.in_(units or {uuid.uuid4()})))))
            q = q.where(LessonNote.subject_id.in_(subs or {uuid.uuid4()}), LessonNote.user_id != user.id)
        q = q.where(LessonNote.status != "draft")
    elif not runs(user, s):
        raise not_found("School")
    if status_:
        q = q.where(LessonNote.status == status_)
    rows = db.scalars(q.order_by(LessonNote.status != "submitted", LessonNote.updated_at.desc()).limit(300))
    return [note_out(db, user, n) for n in rows]


class ReviewIn(BaseModel):
    approve: bool
    note: str | None = Field(default=None, max_length=500)


@router.put("/lesson-notes/{note_id}/review", response_model=NoteOut)
def review(note_id: uuid.UUID, data: ReviewIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    n = db.get(LessonNote, note_id)
    if not n:
        raise not_found("Lesson note")
    school = school_for(db, user, n.school_id)
    if n.user_id == user.id or not may_review(db, user, school, db.get(Subject, n.subject_id)):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the subject's HOD, unit head, a vice principal or the principal can review this")
    if n.status != "submitted":
        raise HTTPException(status.HTTP_409_CONFLICT, "This note isn't waiting for review")
    if not data.approve and not (data.note or "").strip():
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Say what needs to change when you return a note")
    n.status = "approved" if data.approve else "returned"
    n.reviewer_id, n.reviewed_at, n.review_note = user.id, datetime.now(timezone.utc), data.note
    db.commit()
    return note_out(db, user, n)
