"""Admissions: a public application form, the entrance test, offers, and enrolment straight into the school.

The flow: new -> reviewing -> test_booked -> tested -> offered -> accepted -> enrolled.
Side roads: waitlist, rejected, declined (by the family), withdrawn.
The public form needs no login: it is reached with the school's secret admissions code.
"""
import re
import secrets
import uuid
from collections import Counter
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Response, UploadFile, status
from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.access import check, not_found
from app.api.academics import LEVELS, _level_order
from app.api.deps import current_user
from app.api.people import find_or_create_user
from app.api.staff_day import now_wat
from app.core import rights
from app.core.db import get_db
from app.core.phone import normalize_phone
from app.models import (
    AdmissionSettings, Application, ApplicationDoc, Branch, House, Membership, Notice, Role, School, SchoolClass, Student, StudentDocument,
    StudentEvent, StudentGuardian, StudentHealth, User,
)
from app.models.people import BoardingStatus, Gender, StudentStatus

router = APIRouter(prefix="/api", tags=["admissions"])

STATUSES = {
    "new": ("New", "sparkle", "sky"), "reviewing": ("Being reviewed", "eye", "indigo"), "test_booked": ("Test booked", "calendar", "violet"),
    "tested": ("Tested", "clipboard-list", "teal"), "offered": ("Offered a place", "send", "amber"), "accepted": ("Accepted the offer", "circle-check", "green"),
    "enrolled": ("Enrolled", "graduation-cap", "green"), "waitlist": ("Waiting list", "hourglass", "slate"), "rejected": ("Not offered", "circle-x", "red"),
    "declined": ("Family said no", "circle-x", "orange"), "withdrawn": ("Withdrawn", "log-out", "slate"),
}
# What the family is told at each step (never the staff notes).
FAMILY_TEXT = {
    "new": "We have your application. The school will look at it soon.",
    "reviewing": "The school is looking at your application.",
    "test_booked": "Your child is booked for the entrance test.",
    "tested": "Thank you for coming to the test. The school is deciding now.",
    "offered": "Good news! Your child has been offered a place.",
    "accepted": "You have accepted the offer. The school will finish enrolment and send your login.",
    "enrolled": "Welcome to the school! Your child is now enrolled.",
    "waitlist": "Your child is on the waiting list. The school will contact you if a place opens.",
    "rejected": "We are sorry: the school is not able to offer a place this time.",
    "declined": "You told the school you will not take the place.",
    "withdrawn": "This application was withdrawn.",
}
DOC_KINDS = {"birth_certificate": "Birth certificate", "previous_report": "Last school report", "passport_photo": "Passport photo", "other": "Other"}
ALLOWED = {"application/pdf", "image/jpeg", "image/png", "image/webp"}
MAX_DOC = 4 * 1024 * 1024
WAT = timezone(timedelta(hours=1))


def settings_for(db: Session, school_id: uuid.UUID) -> AdmissionSettings:
    st = db.scalar(select(AdmissionSettings).where(AdmissionSettings.school_id == school_id))
    if not st:
        y = now_wat().date().year
        levels = sorted({c.level for c in db.scalars(select(SchoolClass).join(Branch, Branch.id == SchoolClass.branch_id).where(Branch.school_id == school_id))}, key=_level_order)
        entry = [l for l in levels if l in ("Nursery 1", "Primary 1", "JSS 1", "SS 1")] or levels[:1]
        st = AdmissionSettings(school_id=school_id, is_open=False, code=secrets.token_urlsafe(9), session_label=f"{y + 1}/{y + 2}" if now_wat().month >= 9 else f"{y}/{y + 1}",
                               levels=entry, test_subjects=["English", "Mathematics", "General paper"], pass_mark=50, offer_days=14)
        db.add(st)
        db.flush()
    return st


def log(a: Application, text: str, by: str | None = None) -> None:
    a.history = [*(a.history or []), {"at": datetime.now(timezone.utc).isoformat(), "text": text, "by": by}]


def next_number(db: Session, school_id: uuid.UUID) -> str:
    y = now_wat().date().year
    n = db.scalar(select(func.count()).select_from(Application).where(Application.school_id == school_id, Application.number.like(f"APP/{y}/%"))) or 0
    while True:
        n += 1
        cand = f"APP/{y}/{n:04d}"
        if not db.scalar(select(Application.id).where(Application.school_id == school_id, Application.number == cand)):
            return cand


def school_public(school: School, st: AdmissionSettings, db: Session) -> dict:
    boarding = bool(db.scalar(select(Branch.id).where(Branch.school_id == school.id, Branch.has_boarding.is_(True))))
    return {"name": school.name, "logo": school.logo, "colour": school.colour, "motto": school.motto, "address": school.address, "phone": school.phone,
            "email": school.email, "open": st.is_open, "session": st.session_label, "levels": st.levels or [], "intro": st.intro, "form_fee": st.form_fee,
            "test_on": st.test_on.isoformat() if st.test_on else None, "test_venue": st.test_venue, "boarding": boarding, "doc_kinds": DOC_KINDS}


# ---------- The public form (no login) ----------

def by_code(db: Session, code: str) -> tuple[School, AdmissionSettings]:
    st = db.scalar(select(AdmissionSettings).where(AdmissionSettings.code == code))
    if not st:
        raise not_found("Admissions page")
    return db.get(School, st.school_id), st


@router.get("/public/apply/{code}")
def public_info(code: str, db: Session = Depends(get_db)):
    school, st = by_code(db, code)
    return school_public(school, st, db)


class ApplyIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    first_name: str = Field(min_length=1, max_length=80)
    middle_name: str | None = Field(default=None, max_length=80)
    last_name: str = Field(min_length=1, max_length=80)
    gender: str = Field(pattern="^(male|female)$")
    date_of_birth: date | None = None
    level: str = Field(max_length=20)
    boarding: bool = False
    previous_school: str | None = Field(default=None, max_length=150)
    last_class: str | None = Field(default=None, max_length=40)
    state_of_origin: str | None = Field(default=None, max_length=50)
    lga: str | None = Field(default=None, max_length=80)
    religion: str | None = Field(default=None, max_length=30)
    photo: str | None = Field(default=None, max_length=400_000)
    allergies: str | None = Field(default=None, max_length=300)
    conditions: str | None = Field(default=None, max_length=300)
    support_needs: str | None = Field(default=None, max_length=600)
    parent_name: str = Field(min_length=3, max_length=150)
    parent_relationship: str = Field(default="Parent", max_length=30)
    parent_phone: str = Field(min_length=7, max_length=32)
    parent_email: EmailStr | None = None
    parent_occupation: str | None = Field(default=None, max_length=100)
    home_address: str | None = Field(default=None, max_length=300)
    parent2_name: str | None = Field(default=None, max_length=150)
    parent2_relationship: str | None = Field(default=None, max_length=30)
    parent2_phone: str | None = Field(default=None, max_length=32)
    sibling_note: str | None = Field(default=None, max_length=200)
    heard_from: str | None = Field(default=None, max_length=60)
    website: str | None = None          # left empty by people; robots fill it in

    @field_validator("parent_email", mode="before")
    @classmethod
    def blank_email(cls, v):
        return v or None

    @field_validator("date_of_birth")
    @classmethod
    def dob_ok(cls, v):
        if v and not (date(1990, 1, 1) <= v <= date.today()):
            raise ValueError("Check the date of birth")
        return v


def make_application(db: Session, school: School, st: AdmissionSettings, data: ApplyIn, source: str, by: str | None) -> Application:
    if data.level not in LEVELS:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Choose the class")
    phone = normalize_phone(data.parent_phone)
    if not phone:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Enter a parent's phone number")
    if data.photo and not data.photo.startswith("data:image/"):
        data.photo = None
    # The same child applying twice (same name, same parent phone) is caught.
    dup = db.scalar(select(Application).where(Application.school_id == school.id, Application.parent_phone == phone,
                                              func.lower(Application.first_name) == data.first_name.lower(), func.lower(Application.last_name) == data.last_name.lower(),
                                              Application.status.not_in(["withdrawn", "rejected", "declined"])))
    if dup:
        raise HTTPException(status.HTTP_409_CONFLICT, f"{data.first_name} has already applied (number {dup.number}). Use “Check my application” to follow it.")
    a = Application(school_id=school.id, number=next_number(db, school.id), track_code=secrets.token_hex(3).upper(), source=source,
                    **data.model_dump(exclude={"website", "parent_phone", "parent2_phone", "parent_email"}),
                    parent_phone=phone, parent2_phone=normalize_phone(data.parent2_phone) if data.parent2_phone else None,
                    parent_email=str(data.parent_email).lower() if data.parent_email else None, scores={}, history=[])
    log(a, "Applied online" if source == "online" else "Application taken at the school office", by)
    db.add(a)
    db.flush()
    return a


@router.post("/public/apply/{code}", status_code=201)
def public_apply(code: str, data: ApplyIn, db: Session = Depends(get_db)):
    school, st = by_code(db, code)
    if not st.is_open:
        raise HTTPException(status.HTTP_409_CONFLICT, "Admissions are closed at the moment")
    if data.website:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Something went wrong")
    if st.levels and data.level not in st.levels:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "The school is not taking new students into that class")
    a = make_application(db, school, st, data, "online", None)
    rights.notify_heads(db, school, f"New application: {a.first_name} {a.last_name} for {a.level} ({a.number}).", kind="info", icon="user-plus",
                        link=f"#/school/{school.id}/admissions")
    db.commit()
    return {"number": a.number, "track_code": a.track_code, "name": f"{a.first_name} {a.last_name}"}


def tracked(db: Session, code: str, number: str, track: str) -> tuple[School, AdmissionSettings, Application]:
    school, st = by_code(db, code)
    a = db.scalar(select(Application).where(Application.school_id == school.id, func.upper(Application.number) == number.strip().upper()))
    if not a or not secrets.compare_digest(a.track_code, track.strip().upper()):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No application with that number and code. Check the slip you were given.")
    return school, st, a


@router.get("/public/apply/{code}/status")
def public_status(code: str, number: str = Query(max_length=30), track: str = Query(max_length=12), db: Session = Depends(get_db)):
    school, st, a = tracked(db, code, number, track)
    c = db.get(SchoolClass, a.offer_class_id) if a.offer_class_id else None
    steps = ["new", "test_booked", "tested", "offered", "accepted", "enrolled"]
    reached = {"reviewing": "new"}.get(a.status, a.status)
    docs = list(db.scalars(select(ApplicationDoc.kind).where(ApplicationDoc.application_id == a.id)))
    return {"number": a.number, "name": f"{a.first_name} {a.last_name}", "level": a.level, "status": a.status, "label": STATUSES[a.status][0],
            "text": FAMILY_TEXT[a.status], "steps": steps, "step": steps.index(reached) if reached in steps else None,
            "test": {"on": st.test_on.isoformat() if st.test_on else None, "venue": st.test_venue} if a.status == "test_booked" else None,
            "offer": {"class_name": c.name if c else a.level, "boarding": a.boarding, "expires": a.offer_expires.isoformat() if a.offer_expires else None,
                      "note": a.offer_note, "session": st.session_label} if a.status in ("offered", "accepted", "enrolled") else None,
            "can_respond": a.status == "offered", "documents": docs, "school": {"name": school.name, "phone": school.phone}}


class RespondIn(BaseModel):
    number: str = Field(max_length=30)
    track: str = Field(max_length=12)
    accept: bool


@router.post("/public/apply/{code}/respond")
def public_respond(code: str, data: RespondIn, db: Session = Depends(get_db)):
    school, st, a = tracked(db, code, data.number, data.track)
    if a.status != "offered":
        raise HTTPException(status.HTTP_409_CONFLICT, "There is no offer waiting for an answer")
    if a.offer_expires and a.offer_expires < now_wat().date():
        raise HTTPException(status.HTTP_409_CONFLICT, "This offer has run out. Please call the school.")
    a.status = "accepted" if data.accept else "declined"
    log(a, "The family accepted the offer" if data.accept else "The family declined the offer", a.parent_name)
    rights.notify_heads(db, school, f"{a.first_name} {a.last_name} ({a.number}): the family {'accepted' if data.accept else 'declined'} the offer.",
                        kind="info", icon="circle-check" if data.accept else "circle-x", link=f"#/school/{school.id}/admissions")
    db.commit()
    return {"status": a.status, "text": FAMILY_TEXT[a.status]}


@router.post("/public/apply/{code}/documents", status_code=201)
def public_upload(code: str, number: str = Form(max_length=30), track: str = Form(max_length=12), kind: str = Form(...), file: UploadFile = File(...),
                  db: Session = Depends(get_db)):
    school, st, a = tracked(db, code, number, track)
    if a.status in ("enrolled", "withdrawn", "rejected", "declined"):
        raise HTTPException(status.HTTP_409_CONFLICT, "This application is closed")
    return save_doc(db, a, kind, file)


def save_doc(db: Session, a: Application, kind: str, file: UploadFile) -> dict:
    if kind not in DOC_KINDS:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Choose what the document is")
    if file.content_type not in ALLOWED:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Send a PDF or a photo (JPG or PNG)")
    data = file.file.read(MAX_DOC + 1)
    if len(data) > MAX_DOC:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "That file is too big (4 MB at most)")
    if db.scalar(select(func.count()).select_from(ApplicationDoc).where(ApplicationDoc.application_id == a.id)) >= 8:
        raise HTTPException(status.HTTP_409_CONFLICT, "Eight documents at most")
    d = ApplicationDoc(application_id=a.id, kind=kind, filename=(file.filename or "document")[:200], content_type=file.content_type, size=len(data), data=data)
    db.add(d)
    db.commit()
    return {"id": str(d.id), "kind": kind, "label": DOC_KINDS[kind], "filename": d.filename, "size": d.size}


# ---------- The school's side ----------

def need_school(db: Session, user: User, school_id: uuid.UUID) -> School:
    s = db.get(School, school_id)
    if not s:
        raise not_found("School")
    check(user, s, "students")
    return s


def need_app(db: Session, user: User, app_id: uuid.UUID) -> tuple[Application, School]:
    a = db.get(Application, app_id)
    if not a:
        raise not_found("Application")
    return a, need_school(db, user, a.school_id)


def age_on(dob: date | None, on: date) -> int | None:
    return (on.year - dob.year - ((on.month, on.day) < (dob.month, dob.day))) if dob else None


def row(a: Application, classes: dict, today: date, docs: Counter | None = None) -> dict:
    c = classes.get(a.offer_class_id)
    return {"id": str(a.id), "number": a.number, "status": a.status, "label": STATUSES[a.status][0], "icon": STATUSES[a.status][1], "hue": STATUSES[a.status][2],
            "first_name": a.first_name, "middle_name": a.middle_name, "last_name": a.last_name, "gender": a.gender, "level": a.level, "boarding": a.boarding,
            "age": age_on(a.date_of_birth, today), "date_of_birth": a.date_of_birth.isoformat() if a.date_of_birth else None, "photo": a.photo,
            "previous_school": a.previous_school, "parent_name": a.parent_name, "parent_phone": a.parent_phone, "source": a.source,
            "scores": a.scores or {}, "score_total": a.score_total, "offer_class": c.name if c else None,
            "offer_expires": a.offer_expires.isoformat() if a.offer_expires else None, "student_id": str(a.student_id) if a.student_id else None,
            "applied_at": a.created_at.isoformat(), "docs": (docs or {}).get(a.id, 0), "sibling_note": a.sibling_note,
            "alert": bool(a.allergies or a.conditions or a.support_needs)}


def school_classes(db: Session, school_id: uuid.UUID) -> dict:
    return {c.id: c for c in db.scalars(select(SchoolClass).join(Branch, Branch.id == SchoolClass.branch_id).where(Branch.school_id == school_id)
                                         .order_by(SchoolClass.level_order, SchoolClass.arm))}


def settings_out(st: AdmissionSettings) -> dict:
    return {"is_open": st.is_open, "code": st.code, "session_label": st.session_label, "levels": st.levels or [], "intro": st.intro, "form_fee": st.form_fee,
            "test_on": st.test_on.isoformat() if st.test_on else None, "test_venue": st.test_venue, "test_subjects": st.test_subjects or [],
            "pass_mark": st.pass_mark, "offer_days": st.offer_days}


@router.get("/schools/{school_id}/admissions")
def overview(school_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    school = need_school(db, user, school_id)
    st = settings_for(db, school_id)
    apps = list(db.scalars(select(Application).where(Application.school_id == school_id).order_by(Application.created_at.desc())))
    classes = school_classes(db, school_id)
    today = now_wat().date()
    docs = Counter(db.scalars(select(ApplicationDoc.application_id).where(ApplicationDoc.application_id.in_([a.id for a in apps] or [uuid.uuid4()]))))
    counts = Counter(a.status for a in apps)
    # Places: free seats in the entry classes (30 a class unless the class says otherwise).
    places = []
    for lv in st.levels or []:
        cs = [c for c in classes.values() if c.level == lv]
        cap = sum((getattr(c, "capacity", None) or 30) for c in cs)
        have = db.scalar(select(func.count()).select_from(Student).where(Student.class_id.in_([c.id for c in cs] or [uuid.uuid4()]), Student.status == StudentStatus.active)) or 0
        incoming = sum(1 for a in apps if a.level == lv and a.status in ("offered", "accepted"))
        places.append({"level": lv, "capacity": cap, "students": have, "offered": incoming, "free": max(0, cap - have - incoming), "applied": sum(1 for a in apps if a.level == lv)})
    out = {"settings": settings_out(st), "school": school_public(school, st, db), "statuses": {k: {"label": v[0], "icon": v[1], "hue": v[2]} for k, v in STATUSES.items()},
           "counts": counts, "applications": [row(a, classes, today, docs) for a in apps], "places": places,
           "classes": [{"id": str(c.id), "name": c.name, "level": c.level} for c in classes.values()], "levels": LEVELS, "insights": insights(apps, st, today, places)}
    db.commit()
    return out


def insights(apps: list[Application], st: AdmissionSettings, today: date, places: list[dict]) -> list[dict]:
    tips = []
    waiting = [a for a in apps if a.status == "new" and a.created_at.date() <= today - timedelta(days=5)]
    if waiting:
        tips.append({"kind": "alert", "icon": "clock", "text": f"{len(waiting)} application{'s have' if len(waiting) > 1 else ' has'} waited more than 5 days without a reply."})
    expiring = [a for a in apps if a.status == "offered" and a.offer_expires and today <= a.offer_expires <= today + timedelta(days=3)]
    if expiring:
        tips.append({"kind": "tip", "icon": "hourglass", "text": f"{len(expiring)} offer{'s run' if len(expiring) > 1 else ' runs'} out in the next 3 days. A reminder call may help."})
    lapsed = [a for a in apps if a.status == "offered" and a.offer_expires and a.offer_expires < today]
    if lapsed:
        tips.append({"kind": "alert", "icon": "circle-x", "text": f"{len(lapsed)} offer{'s have' if len(lapsed) > 1 else ' has'} run out without an answer."})
    accepted = [a for a in apps if a.status == "accepted"]
    if accepted:
        tips.append({"kind": "tip", "icon": "graduation-cap", "text": f"{len(accepted)} famil{'ies have' if len(accepted) > 1 else 'y has'} accepted. Enrol them to create their profile and parent login."})
    for p in places:
        if p["applied"] and p["free"] == 0:
            tips.append({"kind": "grow", "icon": "users", "text": f"{p['level']} is full with the offers made. Put others on the waiting list."})
    src = Counter(a.heard_from for a in apps if a.heard_from)
    if src and len(apps) >= 5:
        top, n = src.most_common(1)[0]
        tips.append({"kind": "strength", "icon": "megaphone", "text": f"Most families heard about the school from: {top} ({n})."})
    tested = [a for a in apps if a.score_total is not None]
    if len(tested) >= 5:
        avg = round(sum(a.score_total for a in tested) / len(tested))
        tips.append({"kind": "tip", "icon": "chart", "text": f"Average entrance test score: {avg}%. {sum(1 for a in tested if st.pass_mark and a.score_total >= st.pass_mark)} of {len(tested)} passed."})
    return tips


class SettingsIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    is_open: bool
    session_label: str | None = Field(default=None, max_length=30)
    levels: list[str] = Field(max_length=20)
    intro: str | None = Field(default=None, max_length=1000)
    form_fee: int | None = Field(default=None, ge=0, le=10_000_000)
    test_on: datetime | None = None
    test_venue: str | None = Field(default=None, max_length=150)
    test_subjects: list[str] = Field(default_factory=list, max_length=8)
    pass_mark: int | None = Field(default=None, ge=0, le=100)
    offer_days: int = Field(default=14, ge=1, le=90)


@router.put("/schools/{school_id}/admissions/settings")
def save_settings(school_id: uuid.UUID, data: SettingsIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    need_school(db, user, school_id)
    st = settings_for(db, school_id)
    for k, v in data.model_dump().items():
        if k == "levels":
            v = [x for x in v if x in LEVELS]
        if k == "test_subjects":
            v = [x.strip()[:40] for x in v if x.strip()]
        setattr(st, k, v)
    db.commit()
    return settings_out(st)


@router.post("/schools/{school_id}/admissions/new-link")
def new_link(school_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    need_school(db, user, school_id)
    st = settings_for(db, school_id)
    st.code = secrets.token_urlsafe(9)
    db.commit()
    return settings_out(st)


@router.post("/schools/{school_id}/admissions", status_code=201)
def office_apply(school_id: uuid.UUID, data: ApplyIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    school = need_school(db, user, school_id)
    a = make_application(db, school, settings_for(db, school_id), data, "office", user.full_name)
    db.commit()
    return {"id": str(a.id), "number": a.number, "track_code": a.track_code}


@router.get("/applications/{app_id}")
def one(app_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    a, school = need_app(db, user, app_id)
    classes = school_classes(db, school.id)
    st = settings_for(db, school.id)
    out = row(a, classes, now_wat().date())
    out.update({k: getattr(a, k) for k in ("track_code", "last_class", "state_of_origin", "lga", "religion", "allergies", "conditions", "support_needs",
                                           "parent_relationship", "parent_email", "parent_occupation", "home_address", "parent2_name", "parent2_relationship",
                                           "parent2_phone", "heard_from", "interview", "staff_note", "offer_note")})
    out["offer_class_id"] = str(a.offer_class_id) if a.offer_class_id else None
    out["history"] = list(reversed(a.history or []))
    out["documents"] = [{"id": str(d.id), "kind": d.kind, "label": DOC_KINDS.get(d.kind, d.kind), "filename": d.filename, "size": d.size}
                        for d in db.scalars(select(ApplicationDoc).where(ApplicationDoc.application_id == a.id).order_by(ApplicationDoc.created_at))]
    # Brothers or sisters already at the school, found by the parent's phone.
    sibs = list(db.scalars(select(Student).join(StudentGuardian, StudentGuardian.student_id == Student.id).join(User, User.id == StudentGuardian.user_id)
                           .where(Student.school_id == school.id, User.phone.in_([p for p in (a.parent_phone, a.parent2_phone) if p]))))
    out["siblings"] = [{"id": str(s.id), "name": s.full_name, "class_name": s.school_class.name if s.school_class else None} for s in sibs]
    out["test_subjects"] = st.test_subjects or []
    out["pass_mark"] = st.pass_mark
    out["family_text"] = FAMILY_TEXT[a.status]
    return out


class EditIn(ApplyIn):
    staff_note: str | None = Field(default=None, max_length=1000)
    interview: str | None = Field(default=None, max_length=1000)


@router.put("/applications/{app_id}")
def edit(app_id: uuid.UUID, data: EditIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    a, school = need_app(db, user, app_id)
    if a.status == "enrolled":
        raise HTTPException(status.HTTP_409_CONFLICT, "Already enrolled: change the student's profile instead")
    for k, v in data.model_dump(exclude={"website", "photo"}).items():
        if k in ("parent_phone", "parent2_phone"):
            v = normalize_phone(v) if v else None
            if k == "parent_phone" and not v:
                raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Enter a parent's phone number")
        if k == "parent_email" and v:
            v = str(v).lower()
        setattr(a, k, v)
    if data.photo is not None:
        a.photo = data.photo or None
    log(a, "Details changed", user.full_name)
    db.commit()
    return one(app_id, user, db)


class StatusIn(BaseModel):
    status: str
    note: str | None = Field(default=None, max_length=300)


@router.put("/applications/{app_id}/status")
def set_status(app_id: uuid.UUID, data: StatusIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    a, school = need_app(db, user, app_id)
    if data.status not in STATUSES or data.status in ("enrolled", "offered", "accepted"):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Use the offer and enrol buttons for those")
    if a.status == "enrolled":
        raise HTTPException(status.HTTP_409_CONFLICT, "Already enrolled")
    a.status = data.status
    log(a, f"{STATUSES[data.status][0]}" + (f": {data.note}" if data.note else ""), user.full_name)
    db.commit()
    return one(app_id, user, db)


class BulkIn(BaseModel):
    ids: list[uuid.UUID] = Field(min_length=1, max_length=500)
    status: str


@router.post("/schools/{school_id}/admissions/bulk-status")
def bulk_status(school_id: uuid.UUID, data: BulkIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    need_school(db, user, school_id)
    if data.status not in ("reviewing", "test_booked", "waitlist", "rejected"):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Not for many at once")
    n = 0
    for a in db.scalars(select(Application).where(Application.id.in_(data.ids), Application.school_id == school_id)):
        if a.status in ("enrolled", "accepted", "offered", "declined", "withdrawn"):
            continue
        a.status = data.status
        log(a, STATUSES[data.status][0], user.full_name)
        n += 1
    db.commit()
    return {"changed": n}


class ScoreRow(BaseModel):
    id: uuid.UUID
    scores: dict[str, int | None]
    absent: bool = False


class ScoresIn(BaseModel):
    rows: list[ScoreRow] = Field(max_length=500)


@router.put("/schools/{school_id}/admissions/scores")
def save_scores(school_id: uuid.UUID, data: ScoresIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Entrance test marks, each out of 100. Saving marks moves a booked child to 'tested'."""
    need_school(db, user, school_id)
    st = settings_for(db, school_id)
    subjects = st.test_subjects or []
    n = 0
    for r in data.rows:
        a = db.get(Application, r.id)
        if not a or a.school_id != school_id or a.status in ("enrolled",):
            continue
        clean = {k: max(0, min(100, int(v))) for k, v in r.scores.items() if k in subjects and v is not None}
        a.scores = clean
        a.score_total = round(sum(clean.values()) / len(subjects)) if subjects and len(clean) == len(subjects) else None
        if r.absent:
            a.scores, a.score_total = {}, None
            log(a, "Missed the entrance test", user.full_name)
        elif a.score_total is not None and a.status in ("new", "reviewing", "test_booked"):
            a.status = "tested"
            log(a, f"Entrance test: {a.score_total}%", user.full_name)
        n += 1
    db.commit()
    return {"saved": n}


class OfferIn(BaseModel):
    class_id: uuid.UUID | None = None
    boarding: bool | None = None
    expires: date | None = None
    note: str | None = Field(default=None, max_length=600)


@router.post("/applications/{app_id}/offer")
def offer(app_id: uuid.UUID, data: OfferIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    a, school = need_app(db, user, app_id)
    if a.status in ("enrolled", "withdrawn"):
        raise HTTPException(status.HTTP_409_CONFLICT, "This application is closed")
    classes = school_classes(db, school.id)
    if data.class_id and data.class_id not in classes:
        raise not_found("Class")
    st = settings_for(db, school.id)
    a.offer_class_id = data.class_id
    if data.boarding is not None:
        a.boarding = data.boarding
    a.offer_expires = data.expires or now_wat().date() + timedelta(days=st.offer_days or 14)
    a.offer_note = data.note
    a.status = "offered"
    log(a, f"Offered a place{' in ' + classes[data.class_id].name if data.class_id else ''}, answer by {a.offer_expires:%d %b %Y}", user.full_name)
    db.commit()
    return one(app_id, user, db)


class AcceptIn(BaseModel):
    accept: bool


@router.post("/applications/{app_id}/answer")
def office_answer(app_id: uuid.UUID, data: AcceptIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """The family answered at the school or on the phone."""
    a, school = need_app(db, user, app_id)
    if a.status != "offered":
        raise HTTPException(status.HTTP_409_CONFLICT, "There is no offer waiting for an answer")
    a.status = "accepted" if data.accept else "declined"
    log(a, f"The family {'accepted' if data.accept else 'declined'} (told the school)", user.full_name)
    db.commit()
    return one(app_id, user, db)


def next_admission_no(db: Session, school_id: uuid.UUID) -> str:
    """Follow the school's own pattern, e.g. JMC/25/0036 -> JMC/26/0001."""
    nums = list(db.scalars(select(Student.admission_no).where(Student.school_id == school_id)))
    yy = now_wat().date().year % 100
    pats = Counter()
    for n in nums:
        m = re.fullmatch(r"([A-Za-z]+)([/-])(\d{2}|\d{4})\2(\d+)", n)
        if m:
            pats[(m.group(1), m.group(2), len(m.group(3)), len(m.group(4)))] += 1
    if pats:
        (prefix, sep, ylen, width), _ = pats.most_common(1)[0]
        year = str(now_wat().date().year) if ylen == 4 else f"{yy:02d}"
        base = f"{prefix}{sep}{year}{sep}"
        used = [int(n[len(base):]) for n in nums if n.startswith(base) and n[len(base):].isdigit()]
        k = max(used, default=0) + 1
        while f"{base}{k:0{width}d}" in nums:
            k += 1
        return f"{base}{k:0{width}d}"
    from app.api.students import _next_admission_no
    return _next_admission_no(db, school_id)


class EnrolIn(BaseModel):
    class_id: uuid.UUID
    admission_no: str | None = Field(default=None, max_length=40)
    house_id: uuid.UUID | None = None


@router.post("/applications/{app_id}/enrol")
def enrol(app_id: uuid.UUID, data: EnrolIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Make the student: profile, class, house, health, documents, and a parent login."""
    a, school = need_app(db, user, app_id)
    if not rights.has(user, school, "students.change", db) or rights.acting(user):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only people who can change students can enrol")
    if a.status == "enrolled":
        raise HTTPException(status.HTTP_409_CONFLICT, "Already enrolled")
    if a.status not in ("accepted", "offered"):
        raise HTTPException(status.HTTP_409_CONFLICT, "Offer a place first")
    classes = school_classes(db, school.id)
    c = classes.get(data.class_id)
    if not c:
        raise not_found("Class")
    branch = db.get(Branch, c.branch_id)
    if a.boarding and not branch.has_boarding:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "That campus has no boarding")
    number = (data.admission_no or "").strip() or next_admission_no(db, school.id)
    if db.scalar(select(Student.id).where(Student.school_id == school.id, func.lower(Student.admission_no) == number.lower())):
        raise HTTPException(status.HTTP_409_CONFLICT, f"Admission number {number} is already used")
    house_id = data.house_id
    if not house_id:
        # The house with the fewest students of this gender, so houses stay even.
        hs = list(db.scalars(select(House).where(House.school_id == school.id)))
        if hs:
            sizes = dict(db.execute(select(Student.house_id, func.count()).where(Student.school_id == school.id, Student.status == StudentStatus.active,
                                                                                 Student.gender == Gender(a.gender)).group_by(Student.house_id)).all())
            house_id = min(hs, key=lambda h: (sizes.get(h.id, 0), h.name)).id
    s = Student(school_id=school.id, branch_id=branch.id, class_id=c.id, admission_no=number, first_name=a.first_name, middle_name=a.middle_name,
                last_name=a.last_name, gender=Gender(a.gender), date_of_birth=a.date_of_birth, state_of_origin=a.state_of_origin, lga=a.lga,
                religion=a.religion, home_address=a.home_address, previous_school=a.previous_school, entry_class=c.level, admitted_on=now_wat().date(),
                boarding_status=BoardingStatus.boarder if a.boarding else BoardingStatus.day, photo=a.photo, house_id=house_id,
                support_needs=a.support_needs, talents=[])
    if a.photo:
        s.photo_thumb = None    # made the next time the photo is saved; the list falls back to initials
    db.add(s)
    db.flush()
    db.add(StudentEvent(student_id=s.id, kind="admitted", text=f"Admitted into {c.name} from application {a.number}", by_id=user.id))
    if a.allergies or a.conditions:
        db.add(StudentHealth(student_id=s.id, allergies=a.allergies, conditions=a.conditions))
    logins = []
    for i, (name, rel, phone) in enumerate([(a.parent_name, a.parent_relationship, a.parent_phone), (a.parent2_name, a.parent2_relationship, a.parent2_phone)]):
        if not name or not phone:
            continue
        email = a.parent_email if i == 0 and a.parent_email and not db.scalar(select(User.id).where(User.email == a.parent_email)) else None
        u, pw = find_or_create_user(db, name, phone, email)
        db.add(StudentGuardian(student_id=s.id, user_id=u.id, relationship_label=rel or "Parent", is_primary=i == 0,
                               occupation=a.parent_occupation if i == 0 else None, address=a.home_address))
        if not db.scalar(select(Membership.id).where(Membership.user_id == u.id, Membership.role == Role.parent, Membership.branch_id == branch.id)):
            db.add(Membership(user_id=u.id, role=Role.parent, group_id=school.group_id, school_id=school.id, branch_id=branch.id))
        if pw:
            logins.append({"name": u.full_name, "username": u.phone or u.email, "password": pw})
        else:
            logins.append({"name": u.full_name, "username": u.phone or u.email, "password": None})
    for d in db.scalars(select(ApplicationDoc).where(ApplicationDoc.application_id == a.id)):
        db.add(StudentDocument(school_id=school.id, student_id=s.id, kind=d.kind if d.kind != "previous_report" else "previous_report",
                               filename=d.filename, content_type=d.content_type, size=d.size, data=d.data, uploaded_by_id=user.id))
    a.status, a.student_id = "enrolled", s.id
    log(a, f"Enrolled into {c.name} as {number}", user.full_name)
    db.commit()
    return {"student_id": str(s.id), "admission_no": number, "class_name": c.name, "logins": logins}


@router.get("/applications/{app_id}/documents/{doc_id}")
def doc(app_id: uuid.UUID, doc_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    a, _ = need_app(db, user, app_id)
    d = db.get(ApplicationDoc, doc_id)
    if not d or d.application_id != a.id:
        raise not_found("Document")
    return Response(d.data, media_type=d.content_type, headers={"Content-Disposition": f'inline; filename="{d.filename}"'})


@router.post("/applications/{app_id}/documents", status_code=201)
def office_upload(app_id: uuid.UUID, kind: str = Form(...), file: UploadFile = File(...), user: User = Depends(current_user), db: Session = Depends(get_db)):
    a, _ = need_app(db, user, app_id)
    return save_doc(db, a, kind, file)


@router.get("/applications/{app_id}/letter")
def letter(app_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """What an offer letter or test invitation needs."""
    a, school = need_app(db, user, app_id)
    st = settings_for(db, school.id)
    head = db.scalar(select(User).join(Membership, Membership.user_id == User.id).where(Membership.school_id == school.id, Membership.role == Role.head))
    c = db.get(SchoolClass, a.offer_class_id) if a.offer_class_id else None
    return {"school": {**school_public(school, st, db), "approval_number": school.approval_number}, "head": head.full_name if head else None,
            "application": {"number": a.number, "track_code": a.track_code, "name": " ".join(x for x in (a.first_name, a.middle_name, a.last_name) if x),
                            "first_name": a.first_name, "gender": a.gender, "level": a.level, "class_name": c.name if c else a.level, "boarding": a.boarding,
                            "parent_name": a.parent_name, "home_address": a.home_address, "expires": a.offer_expires.isoformat() if a.offer_expires else None,
                            "note": a.offer_note, "status": a.status},
            "settings": {"session": st.session_label, "test_on": st.test_on.isoformat() if st.test_on else None, "test_venue": st.test_venue,
                         "test_subjects": st.test_subjects or [], "code": st.code},
            "today": now_wat().date().isoformat()}
