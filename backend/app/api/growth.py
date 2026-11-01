"""Staff quality and growth.

Lesson observations, appraisals with goals, training (CPD), mentoring, kudos, the weekly
wellbeing check-in, the strengths map, workload, and each person's growth passport.
The "insights" are worked out here with plain rules, so they work without internet or an AI key.

Who sees what:
- the principal, vice principals, IT team and owner ("run the school") see everything except
  private wellbeing answers, which nobody but the person sees;
- a head of department or unit sees the people in their department or unit;
- everyone sees their own.
"""
import uuid
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta, timezone
from statistics import mean

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.api.access import not_found
from app.api.deps import current_user
from app.api.staff_day import WAT, now_wat, runs, school_for, staff_ids
from app.core.db import get_db
from app.models import (
    Appraisal, ClassSubject, CpdRecord, Department, DutyAssignment, GrowthSettings, Kudos, LeaveRequest, LessonNote, Membership,
    Mentoring, Observation, Pulse, Role, School, SchoolClass, StaffAttendance, StaffDaySettings, StaffProfile, Strength, Subject,
    TeachingGroup, Unit, User,
)

router = APIRouter(prefix="/api", tags=["growth"])

# ---------- The school's standards and lists ----------

CRITERIA = [
    {"key": "planning", "label": "Planning and objectives", "icon": "clipboard-list", "hint": "Clear objectives, a lesson note ready, timing planned"},
    {"key": "knowledge", "label": "Subject knowledge", "icon": "brain", "hint": "Accurate, confident, links to real life and exams"},
    {"key": "delivery", "label": "Clear teaching", "icon": "presentation", "hint": "Explains well, good examples, good use of the board"},
    {"key": "questioning", "label": "Questioning", "icon": "megaphone", "hint": "Asks many students, open questions, waits for answers"},
    {"key": "engagement", "label": "Students engaged", "icon": "users", "hint": "Students busy, interested and taking part"},
    {"key": "management", "label": "Class control", "icon": "shield-check", "hint": "Calm, orderly, firm and fair; no time wasted"},
    {"key": "assessment", "label": "Checking learning", "icon": "check", "hint": "Checks understanding, gives feedback, marks work"},
    {"key": "inclusion", "label": "Every child included", "icon": "hand-heart", "hint": "Helps slower learners, stretches the able, fair to all"},
    {"key": "resources", "label": "Teaching aids and ICT", "icon": "lightbulb", "hint": "Charts, models, real objects, practicals or ICT"},
]
CRIT_KEYS = [c["key"] for c in CRITERIA]
CRIT_LABEL = {c["key"]: c["label"] for c in CRITERIA}
PROFESSIONAL = [
    {"key": "punctuality", "label": "Punctuality and conduct", "icon": "clock", "hint": "On time to school and lessons; professional manner"},
    {"key": "records", "label": "Records and paperwork", "icon": "file", "hint": "Lesson notes, registers, scores and reports on time"},
    {"key": "teamwork", "label": "Teamwork", "icon": "handshake", "hint": "Supports colleagues and the department"},
    {"key": "pastoral", "label": "Care for students", "icon": "heart-pulse", "hint": "Welfare, discipline, form-class duties, extra help"},
    {"key": "development", "label": "Own development", "icon": "sprout", "hint": "Training, trying new ideas, acting on feedback"},
]
AREAS = CRITERIA + PROFESSIONAL
AREA_KEYS = [a["key"] for a in AREAS]
LEVELS = {1: "Needs support", 2: "Developing", 3: "Good", 4: "Outstanding"}
CPD_KINDS = {"workshop": "Workshop", "course": "Course", "conference": "Conference", "in_school": "In-school training (INSET)",
             "online": "Online course", "peer": "Watching a colleague teach", "mentoring": "Mentoring session",
             "reading": "Reading and research", "exam_marking": "WAEC/NECO marking", "other": "Other"}
BADGES = {
    "above_beyond": "Above and beyond", "great_lesson": "Brilliant lesson", "team_player": "Team player",
    "student_champion": "Students' champion", "innovator": "New ideas", "reliable": "Always reliable",
    "mentor": "Great mentor", "kind_heart": "Kind heart", "spirit": "School spirit",
}
SKILLS = {
    "Teaching": ["Exam setting and marking", "Practical and lab work", "Helping slower learners", "Stretching able students",
                 "Project-based learning", "Literacy support", "Numeracy support", "Lesson planning"],
    "Technology": ["ICT and computers", "Smartboard and projector", "Spreadsheets and data", "Video and photography", "Coding"],
    "Care and guidance": ["Counselling", "Mentoring new teachers", "Special needs", "Behaviour support", "First aid", "Career guidance"],
    "Clubs and sport": ["Football", "Athletics", "Basketball", "Music", "Choir", "Drama", "Debate", "Quiz and JETS", "Art", "Dance", "Scouts and Guides"],
    "School life": ["Event planning", "Public speaking", "Writing and publications", "Fundraising", "Working with parents", "Chapel and worship"],
    "Languages": ["Igbo", "Yoruba", "Hausa", "French", "Arabic", "Sign language"],
}


def session_start(today: date) -> date:
    """Nigerian school years start in September."""
    return date(today.year if today.month >= 9 else today.year - 1, 9, 1)


def settings_for(db: Session, school_id: uuid.UUID) -> GrowthSettings:
    st = db.scalar(select(GrowthSettings).where(GrowthSettings.school_id == school_id))
    if not st:
        st = GrowthSettings(school_id=school_id, cpd_target_hours=30, workload_limit=36, observations_per_term=1)
        db.add(st)
        db.flush()
    return st


# ---------- Who leads whom ----------

def led_ids(db: Session, user: User, school_id: uuid.UUID) -> set[uuid.UUID]:
    """People in the departments and units this user heads."""
    depts = set(db.scalars(select(Department.id).where(Department.school_id == school_id, Department.head_user_id == user.id)))
    units = set(db.scalars(select(Unit.id).where(Unit.school_id == school_id, Unit.head_user_id == user.id)))
    if not depts and not units:
        return set()
    q = select(StaffProfile.user_id).where(StaffProfile.school_id == school_id, or_(
        StaffProfile.department_id.in_(depts or {uuid.uuid4()}), StaffProfile.unit_id.in_(units or {uuid.uuid4()})))
    return set(db.scalars(q)) - {user.id}


def visible_ids(db: Session, user: User, school: School) -> set[uuid.UUID]:
    if runs(user, school):
        return staff_ids(db, school.id)
    return led_ids(db, user, school.id) | {user.id}


def can_see(db: Session, user: User, school: School, uid: uuid.UUID) -> bool:
    return uid == user.id or runs(user, school) or uid in led_ids(db, user, school.id)


class People:
    """Names, positions and photos for a school, loaded once per request."""

    def __init__(self, db: Session, school_id: uuid.UUID):
        self.ids = staff_ids(db, school_id)
        self.profiles = {p.user_id: p for p in db.scalars(select(StaffProfile).where(StaffProfile.school_id == school_id))}
        users = {u.id: u for u in db.scalars(select(User).where(User.id.in_(self.ids or {uuid.uuid4()})))}
        self.users = users

    def name(self, uid) -> str:
        if not uid:
            return ""
        u, p = self.users.get(uid), self.profiles.get(uid)
        return " ".join(x for x in [p.title if p else None, u.full_name if u else None] if x) or "Former staff"

    def card(self, uid) -> dict:
        p = self.profiles.get(uid)
        return {"user_id": str(uid), "name": self.name(uid), "job_title": p.job_title if p else None,
                "photo": p.photo if p else None, "department_name": p.department.name if p and p.department else None,
                "teaching": bool(p.teaching) if p else True}


# ---------- Settings and lists ----------

class SettingsIO(BaseModel):
    cpd_target_hours: int = Field(ge=0, le=500)
    workload_limit: int = Field(ge=5, le=100)
    observations_per_term: int = Field(ge=0, le=10)


@router.get("/growth/meta")
def meta(user: User = Depends(current_user)):
    return {"criteria": CRITERIA, "professional": PROFESSIONAL, "levels": LEVELS, "cpd_kinds": CPD_KINDS, "badges": BADGES, "skills": SKILLS}


@router.get("/schools/{school_id}/growth/settings", response_model=SettingsIO)
def get_settings(school_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    school_for(db, user, school_id)
    st = settings_for(db, school_id)
    db.commit()
    return SettingsIO(cpd_target_hours=st.cpd_target_hours, workload_limit=st.workload_limit, observations_per_term=st.observations_per_term)


@router.put("/schools/{school_id}/growth/settings", response_model=SettingsIO)
def put_settings(school_id: uuid.UUID, data: SettingsIO, user: User = Depends(current_user), db: Session = Depends(get_db)):
    school_for(db, user, school_id, manage=True)
    st = settings_for(db, school_id)
    for k, v in data.model_dump().items():
        setattr(st, k, v)
    db.commit()
    return data


# ---------- Lesson observations ----------

class ObsIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    teacher_id: uuid.UUID
    subject_id: uuid.UUID | None = None
    class_label: str | None = Field(default=None, max_length=60)
    on_date: date
    kind: str = Field(default="formal", pattern="^(formal|drop_in|peer)$")
    focus: str | None = Field(default=None, max_length=200)
    scores: dict[str, int] = {}
    strengths: str | None = Field(default=None, max_length=4000)
    next_steps: str | None = Field(default=None, max_length=4000)
    status: str = Field(default="draft", pattern="^(planned|draft|shared)$")


def obs_out(o: Observation, ppl: People, db: Session, user: User, school: School) -> dict:
    s = db.get(Subject, o.subject_id) if o.subject_id else None
    vals = [v for v in o.scores.values() if isinstance(v, int)]
    mine_to_edit = (o.observer_id == user.id or runs(user, school)) and o.status != "acknowledged"
    return {"id": str(o.id), "teacher": ppl.card(o.teacher_id), "observer_id": str(o.observer_id) if o.observer_id else None,
            "observer": ppl.name(o.observer_id), "subject_id": str(o.subject_id) if o.subject_id else None,
            "subject_name": s.name if s else None, "class_label": o.class_label, "on_date": o.on_date.isoformat(), "kind": o.kind,
            "focus": o.focus, "scores": o.scores, "average": round(mean(vals), 2) if vals else None, "strengths": o.strengths,
            "next_steps": o.next_steps, "status": o.status, "teacher_comment": o.teacher_comment,
            "shared_at": o.shared_at.isoformat() if o.shared_at else None,
            "can_edit": mine_to_edit, "can_acknowledge": o.teacher_id == user.id and o.status == "shared"}


def check_scores(scores: dict) -> dict:
    out = {}
    for k, v in scores.items():
        if k not in CRIT_KEYS:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Unknown standard '{k}'")
        if v is not None:
            if not isinstance(v, int) or not 1 <= v <= 4:
                raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Scores go from 1 (needs support) to 4 (outstanding)")
            out[k] = v
    return out


@router.get("/schools/{school_id}/observations")
def list_observations(school_id: uuid.UUID, teacher: uuid.UUID | None = None, user: User = Depends(current_user), db: Session = Depends(get_db)):
    school = school_for(db, user, school_id)
    ppl = People(db, school_id)
    q = select(Observation).where(Observation.school_id == school_id)
    if not runs(user, school):
        led = led_ids(db, user, school_id)
        q = q.where(or_(Observation.observer_id == user.id, Observation.teacher_id.in_(led or {uuid.uuid4()}),
                        (Observation.teacher_id == user.id) & Observation.status.in_(["shared", "acknowledged"])))
    if teacher:
        q = q.where(Observation.teacher_id == teacher)
    rows = db.scalars(q.order_by(Observation.on_date.desc()).limit(500))
    return [obs_out(o, ppl, db, user, school) for o in rows]


def may_observe(db: Session, user: User, school: School, teacher_id: uuid.UUID, kind: str) -> bool:
    if teacher_id == user.id:
        return False
    return runs(user, school) or teacher_id in led_ids(db, user, school.id) or kind == "peer"


@router.post("/schools/{school_id}/observations", status_code=201)
def add_observation(school_id: uuid.UUID, data: ObsIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    school = school_for(db, user, school_id)
    if data.teacher_id not in staff_ids(db, school_id):
        raise not_found("Teacher")
    if not may_observe(db, user, school, data.teacher_id, data.kind):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the principal, vice principals and heads of department or unit can observe this teacher. Anyone can do a peer observation.")
    o = Observation(school_id=school_id, observer_id=user.id, **data.model_dump(exclude={"scores"}), scores=check_scores(data.scores))
    if o.status == "shared":
        o.shared_at = datetime.now(timezone.utc)
    db.add(o)
    db.commit()
    return obs_out(o, People(db, school_id), db, user, school)


@router.put("/observations/{obs_id}")
def edit_observation(obs_id: uuid.UUID, data: ObsIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    o = db.get(Observation, obs_id)
    if not o:
        raise not_found("Observation")
    school = school_for(db, user, o.school_id)
    if not (o.observer_id == user.id or runs(user, school)):
        raise not_found("Observation")
    if o.status == "acknowledged":
        raise HTTPException(status.HTTP_409_CONFLICT, "The teacher has already signed this observation")
    for k, v in data.model_dump(exclude={"scores", "teacher_id"}).items():
        setattr(o, k, v)
    o.scores = check_scores(data.scores)
    if o.status == "shared" and not o.shared_at:
        o.shared_at = datetime.now(timezone.utc)
    db.commit()
    return obs_out(o, People(db, o.school_id), db, user, school)


class AckIn(BaseModel):
    comment: str | None = Field(default=None, max_length=2000)


@router.put("/observations/{obs_id}/acknowledge")
def acknowledge(obs_id: uuid.UUID, data: AckIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    o = db.get(Observation, obs_id)
    if not o or o.teacher_id != user.id or o.status not in ("shared", "acknowledged"):
        raise not_found("Observation")
    o.status, o.teacher_comment, o.acknowledged_at = "acknowledged", data.comment, datetime.now(timezone.utc)
    db.commit()
    school = db.get(School, o.school_id)
    return obs_out(o, People(db, o.school_id), db, user, school)


@router.delete("/observations/{obs_id}", status_code=204)
def delete_observation(obs_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    o = db.get(Observation, obs_id)
    if not o:
        raise not_found("Observation")
    school = school_for(db, user, o.school_id)
    if not (o.observer_id == user.id or runs(user, school)) or o.status == "acknowledged":
        raise not_found("Observation")
    db.delete(o)
    db.commit()
    return Response(status_code=204)


# ---------- Appraisals ----------

def default_appraiser(db: Session, school_id: uuid.UUID, uid: uuid.UUID, fallback: uuid.UUID) -> uuid.UUID:
    p = db.scalar(select(StaffProfile).where(StaffProfile.school_id == school_id, StaffProfile.user_id == uid))
    if p and p.unit_id:
        u = db.get(Unit, p.unit_id)
        if u and u.head_user_id and u.head_user_id != uid:
            return u.head_user_id
    if p and p.department_id:
        d = db.get(Department, p.department_id)
        if d and d.head_user_id and d.head_user_id != uid:
            return d.head_user_id
    for role in (Role.head, Role.vice_principal, Role.head_of_school):
        h = db.scalar(select(Membership.user_id).where(Membership.school_id == school_id, Membership.role == role, Membership.user_id != uid))
        if h:
            return h
    return fallback


def appraisal_out(a: Appraisal, ppl: People, user: User, school: School) -> dict:
    manage = runs(user, school, level="change")
    role = "staff" if a.user_id == user.id else "appraiser" if a.appraiser_id == user.id else "manager" if manage else "viewer"
    hide_review = role == "staff" and a.status in ("self", "review")   # staff see the appraiser's view once it's ready to sign
    return {"id": str(a.id), "person": ppl.card(a.user_id), "appraiser_id": str(a.appraiser_id) if a.appraiser_id else None,
            "appraiser": ppl.name(a.appraiser_id), "period_label": a.period_label, "due_on": a.due_on.isoformat() if a.due_on else None,
            "status": a.status, "self_scores": a.self_scores, "self_comment": a.self_comment,
            "scores": {} if hide_review else a.scores, "appraiser_comment": None if hide_review else a.appraiser_comment,
            "overall": None if hide_review else a.overall, "goals": a.goals, "staff_comment": a.staff_comment,
            "staff_signed_at": a.staff_signed_at.isoformat() if a.staff_signed_at else None,
            "appraiser_signed_at": a.appraiser_signed_at.isoformat() if a.appraiser_signed_at else None, "role": role,
            "can_self": role == "staff" and a.status == "self",
            "can_review": role in ("appraiser", "manager") and a.status == "review" and a.user_id != user.id,
            "can_sign": (role == "staff" and a.status == "sign" and not a.staff_signed_at)
            or (role in ("appraiser", "manager") and a.user_id != user.id and a.status == "sign" and not a.appraiser_signed_at),
            "can_goals": role in ("staff", "appraiser", "manager")}


class StartIn(BaseModel):
    period_label: str = Field(min_length=3, max_length=60)
    due_on: date | None = None
    user_ids: list[uuid.UUID] | None = None


@router.post("/schools/{school_id}/appraisals/start")
def start_appraisals(school_id: uuid.UUID, data: StartIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    school_for(db, user, school_id, manage=True)
    ids = staff_ids(db, school_id)
    want = set(data.user_ids) & ids if data.user_ids else ids
    made = 0
    for uid in want:
        exists = db.scalar(select(Appraisal.id).where(Appraisal.school_id == school_id, Appraisal.user_id == uid, Appraisal.period_label == data.period_label))
        if exists:
            continue
        db.add(Appraisal(school_id=school_id, user_id=uid, appraiser_id=default_appraiser(db, school_id, uid, user.id),
                         period_label=data.period_label, due_on=data.due_on, status="self", self_scores={}, scores={}, goals=[]))
        made += 1
    db.commit()
    return {"started": made, "already": len(want) - made}


@router.get("/schools/{school_id}/appraisals")
def list_appraisals(school_id: uuid.UUID, period: str | None = None, user: User = Depends(current_user), db: Session = Depends(get_db)):
    school = school_for(db, user, school_id)
    q = select(Appraisal).where(Appraisal.school_id == school_id)
    if not runs(user, school):
        q = q.where(or_(Appraisal.user_id == user.id, Appraisal.appraiser_id == user.id))
    if period:
        q = q.where(Appraisal.period_label == period)
    ppl = People(db, school_id)
    rows = list(db.scalars(q.order_by(Appraisal.created_at.desc())))
    periods = sorted({a.period_label for a in db.scalars(select(Appraisal).where(Appraisal.school_id == school_id))}, reverse=True)
    return {"periods": periods, "appraisals": sorted([appraisal_out(a, ppl, user, school) for a in rows], key=lambda x: x["person"]["name"])}


def get_appraisal(db: Session, user: User, aid: uuid.UUID) -> tuple[Appraisal, School]:
    a = db.get(Appraisal, aid)
    if not a:
        raise not_found("Appraisal")
    school = school_for(db, user, a.school_id)
    if not (a.user_id == user.id or a.appraiser_id == user.id or runs(user, school)):
        raise not_found("Appraisal")
    return a, school


class Goal(BaseModel):
    title: str = Field(min_length=2, max_length=200)
    measure: str | None = Field(default=None, max_length=300)
    due: date | None = None
    progress: int = Field(default=0, ge=0, le=100)


def check_areas(scores: dict) -> dict:
    out = {}
    for k, v in scores.items():
        if k not in AREA_KEYS:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Unknown area '{k}'")
        if v is not None:
            if not isinstance(v, int) or not 1 <= v <= 4:
                raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Ratings go from 1 to 4")
            out[k] = v
    return out


class SelfIn(BaseModel):
    self_scores: dict[str, int] = {}
    self_comment: str | None = Field(default=None, max_length=5000)
    goals: list[Goal] = Field(default=[], max_length=8)
    submit: bool = False


@router.get("/appraisals/{aid}")
def appraisal(aid: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    a, school = get_appraisal(db, user, aid)
    return appraisal_out(a, People(db, a.school_id), user, school)


@router.put("/appraisals/{aid}/self")
def self_review(aid: uuid.UUID, data: SelfIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    a, school = get_appraisal(db, user, aid)
    if a.user_id != user.id or a.status != "self":
        raise HTTPException(status.HTTP_409_CONFLICT, "Your self-review is already sent")
    a.self_scores, a.self_comment = check_areas(data.self_scores), data.self_comment
    a.goals = [g.model_dump(mode="json") for g in data.goals]
    if data.submit:
        if len(a.self_scores) < len(AREA_KEYS) // 2:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Rate yourself on at least half of the areas before sending")
        a.status = "review"
    db.commit()
    return appraisal_out(a, People(db, a.school_id), user, school)


class ReviewIn(BaseModel):
    scores: dict[str, int] = {}
    appraiser_comment: str | None = Field(default=None, max_length=5000)
    overall: int | None = Field(default=None, ge=1, le=4)
    goals: list[Goal] = Field(default=[], max_length=8)
    submit: bool = False


@router.put("/appraisals/{aid}/review")
def review(aid: uuid.UUID, data: ReviewIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    a, school = get_appraisal(db, user, aid)
    if a.user_id == user.id or not (a.appraiser_id == user.id or runs(user, school)):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the appraiser can review")
    if a.status not in ("review", "self"):
        raise HTTPException(status.HTTP_409_CONFLICT, "This review is finished")
    a.scores, a.appraiser_comment, a.overall = check_areas(data.scores), data.appraiser_comment, data.overall
    a.goals = [g.model_dump(mode="json") for g in data.goals]
    if data.submit:
        if a.status == "self":
            raise HTTPException(status.HTTP_409_CONFLICT, "Wait for the staff member to send their self-review")
        if not a.overall:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Give an overall rating")
        a.status = "sign"
    db.commit()
    return appraisal_out(a, People(db, a.school_id), user, school)


class SignIn(BaseModel):
    comment: str | None = Field(default=None, max_length=2000)


@router.put("/appraisals/{aid}/sign")
def sign(aid: uuid.UUID, data: SignIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    a, school = get_appraisal(db, user, aid)
    if a.status != "sign":
        raise HTTPException(status.HTTP_409_CONFLICT, "Not ready to sign")
    now = datetime.now(timezone.utc)
    if a.user_id == user.id:
        a.staff_signed_at, a.staff_comment = now, data.comment
    elif a.appraiser_id == user.id or runs(user, school):
        a.appraiser_signed_at = now
    else:
        raise not_found("Appraisal")
    if a.staff_signed_at and a.appraiser_signed_at:
        a.status = "done"
    db.commit()
    return appraisal_out(a, People(db, a.school_id), user, school)


class GoalsIn(BaseModel):
    goals: list[Goal] = Field(max_length=8)


@router.put("/appraisals/{aid}/goals")
def goals(aid: uuid.UUID, data: GoalsIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    a, school = get_appraisal(db, user, aid)
    a.goals = [g.model_dump(mode="json") for g in data.goals]
    db.commit()
    return appraisal_out(a, People(db, a.school_id), user, school)


class AppraiserIn(BaseModel):
    appraiser_id: uuid.UUID


@router.put("/appraisals/{aid}/appraiser")
def set_appraiser(aid: uuid.UUID, data: AppraiserIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    a, school = get_appraisal(db, user, aid)
    if not runs(user, school):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the people who run the school can change the appraiser")
    if data.appraiser_id == a.user_id or data.appraiser_id not in staff_ids(db, a.school_id):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Choose another member of staff")
    a.appraiser_id = data.appraiser_id
    db.commit()
    return appraisal_out(a, People(db, a.school_id), user, school)


@router.delete("/appraisals/{aid}", status_code=204)
def delete_appraisal(aid: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    a, school = get_appraisal(db, user, aid)
    if not runs(user, school) or a.status == "done":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Finished appraisals are kept")
    db.delete(a)
    db.commit()
    return Response(status_code=204)


# ---------- Training (CPD) ----------

class CpdIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    title: str = Field(min_length=2, max_length=200)
    provider: str | None = Field(default=None, max_length=120)
    kind: str = "workshop"
    on_date: date
    hours: float = Field(gt=0, le=500)
    notes: str | None = Field(default=None, max_length=3000)
    impact: str | None = Field(default=None, max_length=3000)
    user_ids: list[uuid.UUID] | None = None    # the office can record one training for many people (an INSET day)


def cpd_out(c: CpdRecord, ppl: People, user: User, school: School) -> dict:
    return {"id": str(c.id), "person": ppl.card(c.user_id), "title": c.title, "provider": c.provider, "kind": c.kind,
            "kind_label": CPD_KINDS.get(c.kind, c.kind), "on_date": c.on_date.isoformat(), "hours": c.hours, "notes": c.notes,
            "impact": c.impact, "verified": bool(c.verified_by_id), "verified_by": ppl.name(c.verified_by_id) or None,
            "can_edit": c.user_id == user.id or runs(user, school, level="change")}


@router.get("/schools/{school_id}/cpd")
def list_cpd(school_id: uuid.UUID, person: uuid.UUID | None = None, user: User = Depends(current_user), db: Session = Depends(get_db)):
    school = school_for(db, user, school_id)
    vis = visible_ids(db, user, school)
    q = select(CpdRecord).where(CpdRecord.school_id == school_id, CpdRecord.user_id.in_(vis or {uuid.uuid4()}))
    if person:
        q = q.where(CpdRecord.user_id == person)
    ppl = People(db, school_id)
    return [cpd_out(c, ppl, user, school) for c in db.scalars(q.order_by(CpdRecord.on_date.desc()).limit(600))]


@router.post("/schools/{school_id}/cpd", status_code=201)
def add_cpd(school_id: uuid.UUID, data: CpdIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    school = school_for(db, user, school_id)
    if data.kind not in CPD_KINDS:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Choose the kind of training")
    who = set(data.user_ids or [user.id])
    if who != {user.id} and not runs(user, school):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You can only record your own training")
    if not who <= staff_ids(db, school_id):
        raise not_found("Staff member")
    for uid in who:
        db.add(CpdRecord(school_id=school_id, user_id=uid, **data.model_dump(exclude={"user_ids"}),
                         verified_by_id=user.id if runs(user, school) and uid != user.id else None))
    db.commit()
    return {"added": len(who)}


@router.put("/cpd/{cid}")
def edit_cpd(cid: uuid.UUID, data: CpdIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    c = db.get(CpdRecord, cid)
    if not c:
        raise not_found("Training record")
    school = school_for(db, user, c.school_id)
    if not (c.user_id == user.id or runs(user, school)):
        raise not_found("Training record")
    for k, v in data.model_dump(exclude={"user_ids"}).items():
        setattr(c, k, v)
    if c.user_id == user.id and not runs(user, school):
        c.verified_by_id = None   # changed by the person: needs checking again
    db.commit()
    return cpd_out(c, People(db, c.school_id), user, school)


@router.put("/cpd/{cid}/verify")
def verify_cpd(cid: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    c = db.get(CpdRecord, cid)
    if not c:
        raise not_found("Training record")
    school = school_for(db, user, c.school_id)
    if not runs(user, school) and c.user_id not in led_ids(db, user, c.school_id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only a head or the principal can confirm training")
    c.verified_by_id = None if c.verified_by_id else user.id
    db.commit()
    return cpd_out(c, People(db, c.school_id), user, school)


@router.delete("/cpd/{cid}", status_code=204)
def delete_cpd(cid: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    c = db.get(CpdRecord, cid)
    if not c:
        raise not_found("Training record")
    school = school_for(db, user, c.school_id)
    if not (c.user_id == user.id or runs(user, school)):
        raise not_found("Training record")
    db.delete(c)
    db.commit()
    return Response(status_code=204)


def cpd_hours(db: Session, school_id: uuid.UUID, since: date) -> dict[uuid.UUID, float]:
    out: dict = defaultdict(float)
    for c in db.scalars(select(CpdRecord).where(CpdRecord.school_id == school_id, CpdRecord.on_date >= since)):
        out[c.user_id] += c.hours
    return out


# ---------- Mentoring ----------

class MentorIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    mentor_id: uuid.UUID
    mentee_id: uuid.UUID
    focus: str = Field(min_length=2, max_length=200)
    started_on: date | None = None


def mentoring_out(m: Mentoring, ppl: People, user: User, school: School) -> dict:
    return {"id": str(m.id), "mentor": ppl.card(m.mentor_id), "mentee": ppl.card(m.mentee_id), "focus": m.focus,
            "started_on": m.started_on.isoformat(), "status": m.status,
            "meetings": sorted(m.meetings, key=lambda x: x.get("date", ""), reverse=True),
            "can_log": user.id in (m.mentor_id, m.mentee_id) or runs(user, school, level="change"), "can_end": runs(user, school, level="change") or user.id == m.mentor_id}


@router.get("/schools/{school_id}/mentoring")
def list_mentoring(school_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    school = school_for(db, user, school_id)
    q = select(Mentoring).where(Mentoring.school_id == school_id)
    if not runs(user, school):
        led = led_ids(db, user, school_id)
        q = q.where(or_(Mentoring.mentor_id == user.id, Mentoring.mentee_id == user.id, Mentoring.mentee_id.in_(led or {uuid.uuid4()})))
    ppl = People(db, school_id)
    return [mentoring_out(m, ppl, user, school) for m in db.scalars(q.order_by(Mentoring.status, Mentoring.started_on.desc()))]


@router.post("/schools/{school_id}/mentoring", status_code=201)
def add_mentoring(school_id: uuid.UUID, data: MentorIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    school = school_for(db, user, school_id)
    ids = staff_ids(db, school_id)
    if data.mentor_id not in ids or data.mentee_id not in ids or data.mentor_id == data.mentee_id:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Choose two different members of staff")
    if not (runs(user, school) or data.mentee_id in led_ids(db, user, school_id)):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the principal or the mentee's head can set up mentoring")
    m = Mentoring(school_id=school_id, mentor_id=data.mentor_id, mentee_id=data.mentee_id, focus=data.focus,
                  started_on=data.started_on or now_wat().date(), status="active", meetings=[])
    db.add(m)
    db.commit()
    return mentoring_out(m, People(db, school_id), user, school)


class MeetingIn(BaseModel):
    on_date: date
    note: str = Field(min_length=2, max_length=2000)


@router.post("/mentoring/{mid}/meetings")
def add_meeting(mid: uuid.UUID, data: MeetingIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    m = db.get(Mentoring, mid)
    if not m:
        raise not_found("Mentoring")
    school = school_for(db, user, m.school_id)
    if not (user.id in (m.mentor_id, m.mentee_id) or runs(user, school)):
        raise not_found("Mentoring")
    m.meetings = [*m.meetings, {"date": data.on_date.isoformat(), "note": data.note, "by": user.full_name}]
    db.commit()
    return mentoring_out(m, People(db, m.school_id), user, school)


@router.put("/mentoring/{mid}/end")
def end_mentoring(mid: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    m = db.get(Mentoring, mid)
    if not m:
        raise not_found("Mentoring")
    school = school_for(db, user, m.school_id)
    if not (runs(user, school) or user.id == m.mentor_id):
        raise not_found("Mentoring")
    m.status = "ended" if m.status == "active" else "active"
    db.commit()
    return mentoring_out(m, People(db, m.school_id), user, school)


# ---------- Kudos ----------

class KudosIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    to_id: uuid.UUID
    badge: str
    message: str = Field(min_length=3, max_length=400)


def kudos_out(k: Kudos, ppl: People, user: User, school: School) -> dict:
    return {"id": str(k.id), "from": ppl.card(k.from_id) if k.from_id else None, "to": ppl.card(k.to_id), "badge": k.badge,
            "badge_label": BADGES.get(k.badge, k.badge), "message": k.message, "created_at": k.created_at.isoformat(),
            "cheers": len(k.cheers), "cheered": str(user.id) in k.cheers,
            "can_delete": k.from_id == user.id or runs(user, school, level="change")}


@router.get("/schools/{school_id}/kudos")
def list_kudos(school_id: uuid.UUID, person: uuid.UUID | None = None, limit: int = Query(60, le=300),
               user: User = Depends(current_user), db: Session = Depends(get_db)):
    school = school_for(db, user, school_id)
    q = select(Kudos).where(Kudos.school_id == school_id)
    if person:
        q = q.where(Kudos.to_id == person)
    ppl = People(db, school_id)
    return [kudos_out(k, ppl, user, school) for k in db.scalars(q.order_by(Kudos.created_at.desc()).limit(limit))]


@router.post("/schools/{school_id}/kudos", status_code=201)
def add_kudos(school_id: uuid.UUID, data: KudosIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    school = school_for(db, user, school_id)
    if data.to_id == user.id:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Kudos are for someone else. Ask a colleague to notice you!")
    if data.to_id not in staff_ids(db, school_id):
        raise not_found("Staff member")
    if data.badge not in BADGES:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Choose a badge")
    since = datetime.now(timezone.utc) - timedelta(days=1)
    if len(list(db.scalars(select(Kudos.id).where(Kudos.from_id == user.id, Kudos.created_at >= since)))) >= 15:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "That's a lot of kudos for one day. Save some for tomorrow!")
    k = Kudos(school_id=school_id, from_id=user.id, to_id=data.to_id, badge=data.badge, message=data.message, cheers=[])
    db.add(k)
    db.commit()
    return kudos_out(k, People(db, school_id), user, school)


@router.post("/kudos/{kid}/cheer")
def cheer(kid: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    k = db.get(Kudos, kid)
    if not k:
        raise not_found("Kudos")
    school = school_for(db, user, k.school_id)
    me = str(user.id)
    k.cheers = [x for x in k.cheers if x != me] if me in k.cheers else [*k.cheers, me]
    db.commit()
    return kudos_out(k, People(db, k.school_id), user, school)


@router.delete("/kudos/{kid}", status_code=204)
def delete_kudos(kid: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    k = db.get(Kudos, kid)
    if not k:
        raise not_found("Kudos")
    school = school_for(db, user, k.school_id)
    if not (k.from_id == user.id or runs(user, school)):
        raise not_found("Kudos")
    db.delete(k)
    db.commit()
    return Response(status_code=204)


# ---------- Weekly wellbeing check-in ----------

MIN_GROUP = 3   # never show an average made of fewer answers than this


def week_of(d: date) -> date:
    return d - timedelta(days=d.weekday())


class PulseIn(BaseModel):
    mood: int = Field(ge=1, le=5)
    workload: int = Field(ge=1, le=5)
    supported: int = Field(ge=1, le=5)
    wants_chat: bool = False
    note: str | None = Field(default=None, max_length=500)


def pulse_out(p: Pulse | None) -> dict | None:
    return None if not p else {"week_start": p.week_start.isoformat(), "mood": p.mood, "workload": p.workload,
                               "supported": p.supported, "wants_chat": p.wants_chat, "note": p.note}


@router.get("/me/schools/{school_id}/pulse")
def my_pulse(school_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    if user.id not in staff_ids(db, school_id):
        raise not_found("School")
    wk = week_of(now_wat().date())
    rows = list(db.scalars(select(Pulse).where(Pulse.school_id == school_id, Pulse.user_id == user.id).order_by(Pulse.week_start.desc()).limit(12)))
    return {"week_start": wk.isoformat(), "this_week": pulse_out(next((r for r in rows if r.week_start == wk), None)),
            "history": [pulse_out(r) for r in reversed(rows)]}


@router.put("/me/schools/{school_id}/pulse")
def put_pulse(school_id: uuid.UUID, data: PulseIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    if user.id not in staff_ids(db, school_id):
        raise not_found("School")
    wk = week_of(now_wat().date())
    p = db.scalar(select(Pulse).where(Pulse.school_id == school_id, Pulse.user_id == user.id, Pulse.week_start == wk))
    if not p:
        p = Pulse(school_id=school_id, user_id=user.id, week_start=wk)
        db.add(p)
    for k, v in data.model_dump().items():
        setattr(p, k, v)
    db.commit()
    return my_pulse(school_id, user, db)


@router.get("/schools/{school_id}/wellbeing")
def wellbeing(school_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Totals only. Weeks or groups with fewer than three answers are hidden so no one can be picked out."""
    school_for(db, user, school_id, manage=True)
    ppl = People(db, school_id)
    wk = week_of(now_wat().date())
    rows = list(db.scalars(select(Pulse).where(Pulse.school_id == school_id, Pulse.week_start >= wk - timedelta(weeks=11))))
    weeks = []
    for i in range(11, -1, -1):
        w = wk - timedelta(weeks=i)
        rs = [r for r in rows if r.week_start == w]
        ok = len(rs) >= MIN_GROUP
        weeks.append({"week_start": w.isoformat(), "answers": len(rs), "shown": ok,
                      "mood": round(mean(r.mood for r in rs), 2) if ok else None,
                      "workload": round(mean(r.workload for r in rs), 2) if ok else None,
                      "supported": round(mean(r.supported for r in rs), 2) if ok else None,
                      "moods": dict(Counter(r.mood for r in rs)) if ok else {}})
    recent = [r for r in rows if r.week_start >= wk - timedelta(weeks=3)]
    groups = defaultdict(list)
    for r in recent:
        p = ppl.profiles.get(r.user_id)
        groups[p.department.name if p and p.department else "No department"].append(r)
    by_group = [{"name": g, "answers": len(rs), "mood": round(mean(r.mood for r in rs), 2), "workload": round(mean(r.workload for r in rs), 2)}
                for g, rs in groups.items() if len(rs) >= MIN_GROUP * 2]
    chats = [{"person": ppl.card(r.user_id), "week_start": r.week_start.isoformat()}
             for r in rows if r.wants_chat and r.week_start >= wk - timedelta(weeks=1)]
    return {"staff": len(ppl.ids), "min_group": MIN_GROUP, "weeks": weeks, "by_group": sorted(by_group, key=lambda x: x["mood"]), "chats": chats}


# ---------- Strengths map ----------

class SkillIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    skill: str = Field(min_length=2, max_length=60)
    user_id: uuid.UUID | None = None   # the people who run the school can add a strength for someone


@router.get("/schools/{school_id}/strengths")
def strengths(school_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    school_for(db, user, school_id)
    ppl = People(db, school_id)
    rows = list(db.scalars(select(Strength).where(Strength.school_id == school_id, Strength.user_id.in_(ppl.ids or {uuid.uuid4()}))))
    skills: dict[str, list] = defaultdict(list)
    for s in rows:
        skills[s.skill].append({"id": str(s.id), **ppl.card(s.user_id), "endorsements": len(s.endorsed_by),
                                "endorsed": str(user.id) in s.endorsed_by, "mine": s.user_id == user.id})
    group_of = {sk: g for g, lst in SKILLS.items() for sk in lst}
    out = [{"skill": k, "group": group_of.get(k, "Other"), "people": sorted(v, key=lambda x: -x["endorsements"])} for k, v in skills.items()]
    return {"catalog": SKILLS, "skills": sorted(out, key=lambda x: (-len(x["people"]), x["skill"])),
            "people_with_none": [ppl.card(uid) for uid in ppl.ids if not any(s.user_id == uid for s in rows)][:200]}


@router.post("/schools/{school_id}/strengths", status_code=201)
def add_strength(school_id: uuid.UUID, data: SkillIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    school = school_for(db, user, school_id)
    who = data.user_id or user.id
    if who != user.id and not runs(user, school):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Add strengths for yourself, or endorse a colleague's")
    if who not in staff_ids(db, school_id):
        raise not_found("Staff member")
    skill = next((s for lst in SKILLS.values() for s in lst if s.lower() == data.skill.lower()), data.skill)
    if db.scalar(select(Strength.id).where(Strength.school_id == school_id, Strength.user_id == who, Strength.skill == skill)):
        raise HTTPException(status.HTTP_409_CONFLICT, "Already on the list")
    if len(list(db.scalars(select(Strength.id).where(Strength.school_id == school_id, Strength.user_id == who)))) >= 20:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Pick your top 20 strengths")
    db.add(Strength(school_id=school_id, user_id=who, skill=skill, endorsed_by=[]))
    db.commit()
    return {"skill": skill}


@router.post("/strengths/{sid_}/endorse")
def endorse(sid_: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    s = db.get(Strength, sid_)
    if not s:
        raise not_found("Strength")
    school_for(db, user, s.school_id)
    if s.user_id == user.id:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Colleagues endorse your strengths, not you")
    me = str(user.id)
    s.endorsed_by = [x for x in s.endorsed_by if x != me] if me in s.endorsed_by else [*s.endorsed_by, me]
    db.commit()
    return {"endorsements": len(s.endorsed_by), "endorsed": me in s.endorsed_by}


@router.delete("/strengths/{sid_}", status_code=204)
def delete_strength(sid_: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    s = db.get(Strength, sid_)
    if not s:
        raise not_found("Strength")
    school = school_for(db, user, s.school_id)
    if not (s.user_id == user.id or runs(user, school)):
        raise not_found("Strength")
    db.delete(s)
    db.commit()
    return Response(status_code=204)


# ---------- Workload ----------

def workloads(db: Session, school_id: uuid.UUID) -> dict[uuid.UUID, dict]:
    """Load points for each person, with what makes them up. Each class or group taught counts 3,
    a class of their own 2, heading a department 3 or a unit 2, each duty this week 1, each person mentored 1."""
    ids = staff_ids(db, school_id)
    out = {uid: {"classes": 0, "groups": 0, "form": 0, "duties": 0, "lead": 0, "mentoring": 0} for uid in ids}
    for t, in db.execute(select(ClassSubject.teacher_user_id).join(SchoolClass, SchoolClass.id == ClassSubject.class_id)
                         .join(Subject, Subject.id == ClassSubject.subject_id).where(Subject.school_id == school_id, ClassSubject.teacher_user_id.is_not(None))):
        if t in out:
            out[t]["classes"] += 1
    for t, in db.execute(select(TeachingGroup.teacher_user_id).join(Subject, Subject.id == TeachingGroup.subject_id)
                         .where(Subject.school_id == school_id, TeachingGroup.teacher_user_id.is_not(None))):
        if t in out:
            out[t]["groups"] += 1
    for c in db.scalars(select(SchoolClass).where(SchoolClass.form_teacher_id.in_(ids or {uuid.uuid4()}))):
        out[c.form_teacher_id]["form"] += 1
    wk = week_of(now_wat().date())
    for d in db.scalars(select(DutyAssignment).where(DutyAssignment.school_id == school_id, DutyAssignment.on_date >= wk,
                                                     DutyAssignment.on_date < wk + timedelta(days=7))):
        if d.user_id in out:
            out[d.user_id]["duties"] += 1
    for d in db.scalars(select(Department).where(Department.school_id == school_id, Department.head_user_id.is_not(None))):
        if d.head_user_id in out:
            out[d.head_user_id]["lead"] += 3
    for u in db.scalars(select(Unit).where(Unit.school_id == school_id, Unit.head_user_id.is_not(None))):
        if u.head_user_id in out:
            out[u.head_user_id]["lead"] += 2
    for m in db.scalars(select(Mentoring).where(Mentoring.school_id == school_id, Mentoring.status == "active")):
        if m.mentor_id in out:
            out[m.mentor_id]["mentoring"] += 1
    for v in out.values():
        v["points"] = v["classes"] * 3 + v["groups"] * 3 + v["form"] * 2 + v["duties"] + v["lead"] + v["mentoring"]
    return out


@router.get("/schools/{school_id}/workload")
def workload(school_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    school = school_for(db, user, school_id)
    vis = visible_ids(db, user, school)
    st = settings_for(db, school_id)
    ppl = People(db, school_id)
    loads = workloads(db, school_id)
    teaching = [v["points"] for uid, v in loads.items() if ppl.profiles.get(uid) and ppl.profiles[uid].teaching]
    avg = round(mean(teaching), 1) if teaching else 0
    rows = [{**ppl.card(uid), **loads[uid], "level": "over" if loads[uid]["points"] > st.workload_limit
             else "high" if loads[uid]["points"] > st.workload_limit * 0.8 else "light" if loads[uid]["points"] < avg * 0.5 else "ok"}
            for uid in vis if uid in loads]
    db.commit()
    return {"limit": st.workload_limit, "average": avg, "rows": sorted(rows, key=lambda r: -r["points"])}


# ---------- Attendance and paperwork figures used by the passport ----------

def attendance_rate(db: Session, school_id: uuid.UUID, uid: uuid.UUID, days: int = 60) -> dict:
    st = db.scalar(select(StaffDaySettings).where(StaffDaySettings.school_id == school_id))
    work = st.work_days if st else [0, 1, 2, 3, 4]
    today = now_wat().date()
    span = [today - timedelta(days=i) for i in range(1, days + 1) if (today - timedelta(days=i)).weekday() in work]
    rows = {r.on_date: r for r in db.scalars(select(StaffAttendance).where(StaffAttendance.school_id == school_id, StaffAttendance.user_id == uid,
                                                                          StaffAttendance.on_date >= today - timedelta(days=days)))}
    if not rows:
        return {"rate": None, "late": 0, "days": 0}
    leave = list(db.scalars(select(LeaveRequest).where(LeaveRequest.school_id == school_id, LeaveRequest.user_id == uid, LeaveRequest.status == "approved")))
    counted = [d for d in span if not any(l.starts_on <= d <= l.ends_on for l in leave) and not (rows.get(d) and rows[d].status == "excused")]
    first = min(rows)   # don't count days before the school started recording
    counted = [d for d in counted if d >= first]
    present = sum(1 for d in counted if rows.get(d) and rows[d].status in ("present", "late"))
    late = sum(1 for d in counted if rows.get(d) and rows[d].status == "late")
    return {"rate": round(present / len(counted) * 100) if counted else None, "late": late, "days": len(counted)}


# ---------- The growth passport ----------

def obs_averages(obs: list[Observation]) -> dict[str, float]:
    acc: dict = defaultdict(list)
    for o in obs:
        for k, v in o.scores.items():
            if isinstance(v, int):
                acc[k].append(v)
    return {k: round(mean(v), 2) for k, v in acc.items()}


def school_obs_averages(db: Session, school_id: uuid.UUID) -> dict[uuid.UUID, dict[str, float]]:
    per: dict = defaultdict(list)
    for o in db.scalars(select(Observation).where(Observation.school_id == school_id, Observation.status.in_(["shared", "acknowledged"]))):
        per[o.teacher_id].append(o)
    return {uid: obs_averages(lst) for uid, lst in per.items()}


def mentor_matches(db: Session, school_id: uuid.UUID, uid: uuid.UUID, area: str, ppl: People, all_avgs: dict, loads: dict, limit: int) -> list[dict]:
    """Colleagues who are strong where this person is weakest, not overloaded, same department first."""
    mine = ppl.profiles.get(uid)
    out = []
    for other, avgs in all_avgs.items():
        if other == uid or other not in ppl.ids or avgs.get(area, 0) < 3.3:
            continue
        if loads.get(other, {}).get("points", 0) > limit:
            continue
        p = ppl.profiles.get(other)
        same = bool(mine and p and mine.department_id and mine.department_id == p.department_id)
        out.append({**ppl.card(other), "score": avgs[area], "same_department": same})
    return sorted(out, key=lambda x: (-x["same_department"], -x["score"]))[:3]


def passport(db: Session, user: User, school: School, uid: uuid.UUID) -> dict:
    ppl = People(db, school.id)
    st = settings_for(db, school.id)
    today = now_wat().date()
    start = session_start(today)
    p = ppl.profiles.get(uid)
    obs = list(db.scalars(select(Observation).where(Observation.school_id == school.id, Observation.teacher_id == uid,
                                                    Observation.status.in_(["shared", "acknowledged"])).order_by(Observation.on_date)))
    avgs = obs_averages(obs)
    all_avgs = school_obs_averages(db, school.id)
    school_avg = {k: round(mean([a[k] for a in all_avgs.values() if k in a]), 2) for k in CRIT_KEYS if any(k in a for a in all_avgs.values())}
    cpd = list(db.scalars(select(CpdRecord).where(CpdRecord.school_id == school.id, CpdRecord.user_id == uid).order_by(CpdRecord.on_date.desc())))
    hours = sum(c.hours for c in cpd if c.on_date >= start)
    kudos = list(db.scalars(select(Kudos).where(Kudos.school_id == school.id, Kudos.to_id == uid).order_by(Kudos.created_at.desc())))
    given = len(list(db.scalars(select(Kudos.id).where(Kudos.school_id == school.id, Kudos.from_id == uid))))
    apps = list(db.scalars(select(Appraisal).where(Appraisal.school_id == school.id, Appraisal.user_id == uid).order_by(Appraisal.created_at.desc())))
    notes = Counter(n.status for n in db.scalars(select(LessonNote).where(LessonNote.school_id == school.id, LessonNote.user_id == uid,
                                                                          LessonNote.created_at >= datetime.combine(start, datetime.min.time(), WAT))))
    ments = list(db.scalars(select(Mentoring).where(Mentoring.school_id == school.id, or_(Mentoring.mentor_id == uid, Mentoring.mentee_id == uid))))
    strengths_ = list(db.scalars(select(Strength).where(Strength.school_id == school.id, Strength.user_id == uid)))
    loads = workloads(db, school.id)
    load = loads.get(uid, {"points": 0})
    att = attendance_rate(db, school.id, uid)
    years = None
    if p and p.date_joined:
        years = round((today - p.date_joined).days / 365.25, 1)

    # Insights: plain rules, no internet needed.
    tips: list[dict] = []
    if avgs:
        best = max(avgs, key=avgs.get)
        worst = min(avgs, key=avgs.get)
        if avgs[best] >= 3.3:
            tips.append({"kind": "strength", "icon": "star", "text": f"Strongest area: {CRIT_LABEL[best].lower()} ({avgs[best]:.1f} of 4). Could lead a short training for colleagues on it."})
        if avgs[worst] < 2.8 and worst != best:
            matches = mentor_matches(db, school.id, uid, worst, ppl, all_avgs, loads, st.workload_limit)
            tips.append({"kind": "grow", "icon": "sprout", "text": f"Area to grow: {CRIT_LABEL[worst].lower()} ({avgs[worst]:.1f} of 4).",
                         "matches": matches, "area": worst})
        if len(obs) >= 2:
            first, last = obs[0], obs[-1]
            fa = mean([v for v in first.scores.values()]) if first.scores else 0
            la = mean([v for v in last.scores.values()]) if last.scores else 0
            if la - fa >= 0.4:
                tips.append({"kind": "strength", "icon": "trending", "text": f"Improving: observation scores went from {fa:.1f} to {la:.1f}. Worth a kudos!"})
            elif fa - la >= 0.4:
                tips.append({"kind": "alert", "icon": "trending", "text": f"Scores dropped from {fa:.1f} to {la:.1f} since the first observation. A supportive chat may help."})
    elif p is None or p.teaching:
        tips.append({"kind": "tip", "icon": "eye", "text": "Not observed yet this year. Plan a friendly first observation."})
    if hours < st.cpd_target_hours:
        tips.append({"kind": "tip" if hours else "grow", "icon": "graduation-cap",
                     "text": f"{hours:g} of {st.cpd_target_hours} training hours this school year." + (" Nothing recorded yet." if not hours else "")})
    else:
        tips.append({"kind": "strength", "icon": "graduation-cap", "text": f"Training target reached: {hours:g} hours this school year."})
    if load["points"] > st.workload_limit:
        tips.append({"kind": "alert", "icon": "scale", "text": f"Heavy load: {load['points']} points against a limit of {st.workload_limit}. Consider moving a class or a duty."})
    if att["rate"] is not None and att["rate"] < 90:
        tips.append({"kind": "alert", "icon": "calendar-check", "text": f"Attendance {att['rate']}% over the last two months ({att['late']} late)."})
    elif att["late"] >= 5:
        tips.append({"kind": "tip", "icon": "timer", "text": f"Late {att['late']} times in the last two months."})
    if notes.get("returned", 0) >= 2:
        tips.append({"kind": "tip", "icon": "notebook", "text": f"{notes['returned']} lesson notes sent back for changes. A look at the reviewers' comments together could help."})
    if len(kudos) >= 3:
        tips.append({"kind": "strength", "icon": "heart", "text": f"Appreciated by colleagues: {len(kudos)} kudos received."})
    if years is not None and years < 1 and not any(m.mentee_id == uid and m.status == "active" for m in ments):
        tips.append({"kind": "tip", "icon": "handshake", "text": "New this year and has no mentor yet. A mentor helps new staff settle quickly."})

    timeline = (
        [{"date": o.on_date.isoformat(), "kind": "observation", "title": f"Lesson observed by {ppl.name(o.observer_id)}",
          "detail": f"{o.class_label or ''} · average {mean(o.scores.values()):.1f}" if o.scores else o.class_label} for o in obs]
        + [{"date": c.on_date.isoformat(), "kind": "cpd", "title": c.title, "detail": f"{c.hours:g} h · {CPD_KINDS.get(c.kind, c.kind)}"} for c in cpd[:20]]
        + [{"date": k.created_at.astimezone(WAT).date().isoformat(), "kind": "kudos", "title": f"{BADGES.get(k.badge, k.badge)} from {ppl.name(k.from_id)}",
            "detail": k.message} for k in kudos[:20]]
        + [{"date": (a.appraiser_signed_at or a.created_at).astimezone(WAT).date().isoformat(), "kind": "appraisal",
            "title": f"Appraisal {a.period_label}", "detail": LEVELS.get(a.overall, "") if a.status == "done" else "In progress"} for a in apps]
        + [{"date": m.started_on.isoformat(), "kind": "mentoring",
            "title": f"Mentoring {'by ' + ppl.name(m.mentor_id) if m.mentee_id == uid else 'of ' + ppl.name(m.mentee_id)}", "detail": m.focus} for m in ments]
    )
    timeline.sort(key=lambda x: x["date"], reverse=True)
    badge_counts = Counter(k.badge for k in kudos)
    latest = apps[0] if apps else None
    show_latest = latest and (latest.status == "done" or user.id != uid or latest.status == "sign")
    return {
        "person": {**ppl.card(uid), "staff_no": p.staff_no if p else None, "years": years, "unit_name": p.unit.name if p and p.unit else None},
        "is_me": uid == user.id,
        "criteria": CRITERIA, "averages": avgs, "school_averages": school_avg, "observations": len(obs),
        "trend": [{"date": o.on_date.isoformat(), "average": round(mean(o.scores.values()), 2)} for o in obs if o.scores],
        "cpd": {"hours": hours, "target": st.cpd_target_hours, "records": len(cpd)},
        "attendance": att,
        "kudos": {"received": len(kudos), "given": given, "badges": badge_counts,
                  "recent": [kudos_out(k, ppl, user, school) for k in kudos[:4]]},
        "notes": dict(notes),
        "appraisal": {"id": str(latest.id), "period_label": latest.period_label, "status": latest.status,
                      "overall": latest.overall if show_latest else None, "goals": latest.goals} if latest else None,
        "mentoring": [mentoring_out(m, ppl, user, school) for m in ments if m.status == "active"],
        "strengths": [{"id": str(s.id), "skill": s.skill, "endorsements": len(s.endorsed_by), "endorsed": str(user.id) in s.endorsed_by} for s in strengths_],
        "workload": load, "workload_limit": st.workload_limit,
        "insights": tips, "timeline": timeline[:40],
    }


@router.get("/schools/{school_id}/growth/people/{uid}")
def person_passport(school_id: uuid.UUID, uid: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    school = school_for(db, user, school_id)
    if uid not in staff_ids(db, school_id) or not can_see(db, user, school, uid):
        raise not_found("Staff member")
    out = passport(db, user, school, uid)
    db.commit()
    return out


# ---------- School overview ----------

@router.get("/schools/{school_id}/growth/overview")
def overview(school_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    school_for(db, user, school_id, manage=True)
    st = settings_for(db, school_id)
    ppl = People(db, school_id)
    today = now_wat().date()
    start = session_start(today)
    teachers = {uid for uid in ppl.ids if (ppl.profiles.get(uid) and ppl.profiles[uid].teaching)}
    obs = list(db.scalars(select(Observation).where(Observation.school_id == school_id, Observation.on_date >= start)))
    done_obs = [o for o in obs if o.status in ("shared", "acknowledged")]
    observed = {o.teacher_id for o in done_obs}
    all_avgs = school_obs_averages(db, school_id)
    school_avg = {k: round(mean([a[k] for a in all_avgs.values() if k in a]), 2) for k in CRIT_KEYS if any(k in a for a in all_avgs.values())}
    hours = cpd_hours(db, school_id, start)
    met = sum(1 for uid in ppl.ids if hours.get(uid, 0) >= st.cpd_target_hours)
    apps = list(db.scalars(select(Appraisal).where(Appraisal.school_id == school_id)))
    period = max((a.period_label for a in apps), default=None)
    app_counts = Counter(a.status for a in apps if a.period_label == period)
    month = datetime.now(timezone.utc) - timedelta(days=30)
    kudos_month = list(db.scalars(select(Kudos).where(Kudos.school_id == school_id, Kudos.created_at >= month)))
    loads = workloads(db, school_id)
    over = [uid for uid, v in loads.items() if v["points"] > st.workload_limit]
    wb = wellbeing(school_id, user, db)
    shown = [w for w in wb["weeks"] if w["shown"]]
    ment = list(db.scalars(select(Mentoring).where(Mentoring.school_id == school_id, Mentoring.status == "active")))

    tips: list[dict] = []
    if school_avg:
        worst = min(school_avg, key=school_avg.get)
        best = max(school_avg, key=school_avg.get)
        champs = sorted([(uid, a[worst]) for uid, a in all_avgs.items() if a.get(worst, 0) >= 3.5 and uid in ppl.ids], key=lambda x: -x[1])[:3]
        tips.append({"kind": "grow", "icon": "sprout",
                     "text": f"Across the school, {CRIT_LABEL[worst].lower()} is the weakest standard ({school_avg[worst]:.1f} of 4). Plan an in-school training (INSET) on it"
                     + (f", led by {', '.join(ppl.name(c[0]) for c in champs)}, who score highest." if champs else "."),
                     "people": [ppl.card(c[0]) for c in champs]})
        tips.append({"kind": "strength", "icon": "star", "text": f"The school's strongest standard is {CRIT_LABEL[best].lower()} ({school_avg[best]:.1f} of 4)."})
    not_obs = [uid for uid in teachers if uid not in observed]
    if not_obs:
        tips.append({"kind": "tip", "icon": "eye", "text": f"{len(not_obs)} of {len(teachers)} teachers haven't been observed this school year.",
                     "people": [ppl.card(u) for u in sorted(not_obs, key=lambda u: ppl.name(u))[:8]]})
    if over:
        tips.append({"kind": "alert", "icon": "scale", "text": f"{len(over)} staff are above the workload limit of {st.workload_limit} points.",
                     "people": [ppl.card(u) for u in sorted(over, key=lambda u: -loads[u]["points"])[:8]]})
    light = [uid for uid in teachers if 0 < loads.get(uid, {}).get("points", 0) < st.workload_limit * 0.35]
    if over and light:
        tips.append({"kind": "tip", "icon": "refresh", "text": f"{len(light)} teachers have a light load and could take a class or duty from someone overloaded.",
                     "people": [ppl.card(u) for u in light[:8]]})
    no_cpd = [uid for uid in ppl.ids if not hours.get(uid)]
    if no_cpd:
        tips.append({"kind": "tip", "icon": "graduation-cap", "text": f"{len(no_cpd)} staff have no training recorded this school year."})
    if len(shown) >= 2 and shown[-1]["mood"] is not None and shown[-1]["mood"] < shown[-2]["mood"] - 0.4:
        tips.append({"kind": "alert", "icon": "heart-pulse", "text": f"Staff mood fell this week ({shown[-2]['mood']:.1f} → {shown[-1]['mood']:.1f} of 5). A thank-you in the staff meeting goes a long way."})
    if wb["chats"]:
        tips.append({"kind": "alert", "icon": "handshake", "text": f"{len(wb['chats'])} staff asked for a private chat in their wellbeing check-in."})
    newbies = [uid for uid in ppl.ids if ppl.profiles.get(uid) and ppl.profiles[uid].date_joined and (today - ppl.profiles[uid].date_joined).days < 365
               and not any(m.mentee_id == uid for m in ment)]
    if newbies:
        tips.append({"kind": "tip", "icon": "handshake", "text": f"{len(newbies)} staff joined in the last year without a mentor.",
                     "people": [ppl.card(u) for u in newbies[:8]]})

    got = Counter(k.to_id for k in kudos_month)
    db.commit()
    return {
        "staff": len(ppl.ids), "teachers": len(teachers),
        "observations": {"this_year": len(done_obs), "observed": len(observed & teachers), "planned": sum(1 for o in obs if o.status == "planned"),
                         "drafts": sum(1 for o in obs if o.status == "draft")},
        "criteria": CRITERIA, "school_averages": school_avg,
        "cpd": {"hours": round(sum(hours.values()), 1), "met": met, "target": st.cpd_target_hours},
        "appraisals": {"period": period, "counts": dict(app_counts), "total": sum(app_counts.values())},
        "kudos": {"month": len(kudos_month), "top": [{**ppl.card(uid), "count": n} for uid, n in got.most_common(5) if uid in ppl.ids]},
        "workload": {"over": len(over), "limit": st.workload_limit},
        "wellbeing": {"latest": shown[-1] if shown else None, "weeks": wb["weeks"]},
        "mentoring": len(ment),
        "insights": tips,
    }


# ---------- My growth (for the staff portal) ----------

@router.get("/me/schools/{school_id}/growth")
def my_growth(school_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    if user.id not in staff_ids(db, school_id):
        raise not_found("School")
    school = db.get(School, school_id)
    st = settings_for(db, school_id)
    start = session_start(now_wat().date())
    to_ack = len(list(db.scalars(select(Observation.id).where(Observation.school_id == school_id, Observation.teacher_id == user.id, Observation.status == "shared"))))
    drafts = len(list(db.scalars(select(Observation.id).where(Observation.school_id == school_id, Observation.observer_id == user.id,
                                                              Observation.status.in_(["planned", "draft"])))))
    apps = list(db.scalars(select(Appraisal).where(Appraisal.school_id == school_id, or_(Appraisal.user_id == user.id, Appraisal.appraiser_id == user.id))))
    mine = next((a for a in sorted(apps, key=lambda a: a.created_at, reverse=True) if a.user_id == user.id), None)
    to_review = sum(1 for a in apps if a.appraiser_id == user.id and a.user_id != user.id and (a.status == "review" or (a.status == "sign" and not a.appraiser_signed_at)))
    hours = sum(c.hours for c in db.scalars(select(CpdRecord).where(CpdRecord.school_id == school_id, CpdRecord.user_id == user.id, CpdRecord.on_date >= start)))
    kudos = len(list(db.scalars(select(Kudos.id).where(Kudos.school_id == school_id, Kudos.to_id == user.id))))
    wk = week_of(now_wat().date())
    pulse_done = bool(db.scalar(select(Pulse.id).where(Pulse.school_id == school_id, Pulse.user_id == user.id, Pulse.week_start == wk)))
    ments = list(db.scalars(select(Mentoring).where(Mentoring.school_id == school_id, Mentoring.status == "active",
                                                    or_(Mentoring.mentor_id == user.id, Mentoring.mentee_id == user.id))))
    ppl = People(db, school_id)
    db.commit()
    return {"observations_to_sign": to_ack, "observations_to_finish": drafts,
            "appraisal": {"id": str(mine.id), "period_label": mine.period_label, "status": mine.status, "staff_signed": bool(mine.staff_signed_at),
                          "goals": mine.goals} if mine else None,
            "appraisals_to_review": to_review, "cpd_hours": hours, "cpd_target": st.cpd_target_hours, "kudos": kudos,
            "pulse_done": pulse_done, "can_observe": runs(user, school, level="change") or bool(led_ids(db, user, school_id)),
            "mentoring": [mentoring_out(m, ppl, user, school) for m in ments]}


@router.get("/schools/{school_id}/growth/people")
def people(school_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Everyone on the staff with a few figures, for pickers and the Growth people list."""
    school = school_for(db, user, school_id)
    ppl = People(db, school_id)
    vis = visible_ids(db, user, school)
    start = session_start(now_wat().date())
    hours = cpd_hours(db, school_id, start)
    avgs = school_obs_averages(db, school_id)
    kud = Counter(k for k, in db.execute(select(Kudos.to_id).where(Kudos.school_id == school_id)))
    st = settings_for(db, school_id)
    out = []
    for uid in ppl.ids:
        card = ppl.card(uid)
        if uid in vis:
            a = avgs.get(uid)
            card.update({"visible": True, "observation_average": round(mean(a.values()), 2) if a else None, "cpd_hours": hours.get(uid, 0), "kudos": kud.get(uid, 0)})
        else:
            card.update({"visible": False})
        out.append(card)
    db.commit()
    return {"cpd_target": st.cpd_target_hours, "people": sorted(out, key=lambda x: x["name"])}
