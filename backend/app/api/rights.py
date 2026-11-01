"""The Rights page, requests for private records, 'see as', and the bell."""
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.api.access import not_found
from app.api.deps import current_user
from app.core import rights as R
from app.core.db import get_db
from app.core.security import create_access_token
from app.models import AccessGrant, AuditEntry, Membership, Notice, RightSetting, Role, School, StaffProfile, User

router = APIRouter(prefix="/api", tags=["rights"])


def _school(db: Session, user: User, sid: uuid.UUID) -> School:
    s = db.get(School, sid)
    if not s or not (R.owns(user, s) or R.roles_at(user, s)):
        raise not_found("School")
    return s


def rank_of(user: User, school: School) -> int:
    if R.owns(user, school):
        return R.RANK["owner"]
    return max([R.RANK.get(r, 0) for r in R.roles_at(user, school)] or [0])


def approves(user: User, school: School) -> bool:
    """Who says yes or no to private access: the owner, the head of school and the principal."""
    return not R.acting(user) and (R.owns(user, school) or bool(R.roles_at(user, school) & {"head", "head_of_school"}))


def role_rights(settings: list[RightSetting], role: str) -> set[str]:
    have = set(R.DEFAULTS.get(role, set()))
    for s in settings:
        if s.role == role and s.user_id is None:
            (have.add if s.allowed else have.discard)(s.right)
    return have


def head_title(school: School) -> str:
    return school.head_title or "Head of school"


@router.get("/rights/meta")
def meta(user: User = Depends(current_user)):
    return {"areas": R.AREAS, "private": R.PRIVATE, "powers": R.POWERS, "roles": R.ROLE_LABEL, "order": R.SCHOOL_ROLES,
            "defaults": {k: sorted(v) for k, v in R.DEFAULTS.items()}}


def _person(db: Session, school: School, uid: uuid.UUID) -> dict:
    u = db.get(User, uid)
    p = db.scalar(select(StaffProfile).where(StaffProfile.school_id == school.id, StaffProfile.user_id == uid))
    roles = sorted({m.role.value for m in db.scalars(select(Membership).where(Membership.user_id == uid, Membership.school_id == school.id))})
    return {"user_id": str(uid), "name": u.full_name if u else "?", "job_title": p.job_title if p else None, "roles": roles}


@router.get("/schools/{school_id}/rights")
def page(school_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    school = _school(db, user, school_id)
    if not R.has(user, school, "rights.see"):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Rights are not open to you. Ask the principal if you need them.")
    settings = list(db.scalars(select(RightSetting).where(RightSetting.school_id == school.id)))
    mine = rank_of(user, school)
    can = R.has(user, school, "rights.change") and not R.acting(user)
    my_rights = R.rights_of(user, school)
    present = set(db.scalars(select(Membership.role).where(Membership.school_id == school.id)))
    roles = []
    for role in R.SCHOOL_ROLES:
        label = head_title(school) if role == "head_of_school" else R.ROLE_LABEL[role]
        roles.append({"role": role, "label": label, "rights": sorted(role_rights(settings, role)),
                      "changed": sorted({s.right for s in settings if s.role == role and s.user_id is None}),
                      "people": sum(1 for r in present if r.value == role), "editable": can and mine > R.RANK[role]})
    people = {}
    for s in settings:
        if s.user_id:
            people.setdefault(s.user_id, []).append({"right": s.right, "allowed": s.allowed})
    exceptions = [{**_person(db, school, uid), "changes": ch,
                   "editable": can and mine > max([R.RANK.get(r, 0) for r in _person(db, school, uid)["roles"]] or [0])}
                  for uid, ch in people.items()]
    now = datetime.now(timezone.utc)
    reqs = list(db.scalars(select(AccessGrant).where(AccessGrant.school_id == school.id).order_by(AccessGrant.created_at.desc()).limit(40)))
    log = list(db.scalars(select(AuditEntry).where(AuditEntry.school_id == school.id).order_by(AuditEntry.created_at.desc()).limit(60)))
    names = {u.id: u.full_name for u in db.scalars(select(User).where(User.id.in_({r.user_id for r in reqs} | {r.decided_by_id for r in reqs if r.decided_by_id}
                                                                                  | {a.actor_id for a in log if a.actor_id} or {uuid.uuid4()})))}
    return {"school": {"id": str(school.id), "name": school.name, "head_title": head_title(school)},
            "can_change": can, "can_approve": approves(user, school), "my_rights": sorted(my_rights), "roles": roles, "exceptions": exceptions,
            "requests": [grant_out(g, names, now) for g in reqs], "log": [{"at": a.created_at.isoformat(), "who": names.get(a.actor_id), "action": a.action,
                                                                         "what": a.what} for a in log]}


def grant_out(g: AccessGrant, names: dict, now: datetime) -> dict:
    live = g.status == "approved" and g.expires_at and g.expires_at > now
    return {"id": str(g.id), "user_id": str(g.user_id), "name": names.get(g.user_id), "right": g.right,
            "label": R.PRIVATE.get(g.right.split(".")[-1], {}).get("label", g.right), "reason": g.reason, "hours": g.hours,
            "status": "ended" if g.status == "approved" and not live else g.status, "at": g.created_at.isoformat(),
            "decided_by": names.get(g.decided_by_id), "expires_at": g.expires_at.isoformat() if g.expires_at else None, "note": g.note}


class RightIn(BaseModel):
    right: str
    allowed: bool | None    # None: back to the ready-made setting


def _check_change(db: Session, user: User, school: School, right: str, target_rank: int) -> None:
    if R.acting(user) or not R.has(user, school, "rights.change"):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the owner and the head of school can change rights")
    if right not in R.ALL:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Unknown right")
    if rank_of(user, school) <= target_rank:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You can only change rights for people below you")
    if not R.has(user, school, right):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You can't give a right you don't have yourself")


def _set(db: Session, school: School, user: User, right: str, allowed: bool | None, role: str | None = None, uid: uuid.UUID | None = None) -> None:
    row = db.scalar(select(RightSetting).where(RightSetting.school_id == school.id, RightSetting.right == right,
                                               RightSetting.role == role if role else RightSetting.role.is_(None),
                                               RightSetting.user_id == uid if uid else RightSetting.user_id.is_(None)))
    default = right in R.DEFAULTS.get(role, set()) if role else None
    if allowed is None or (role and allowed == default):
        if row:
            db.delete(row)
    elif row:
        row.allowed, row.changed_by_id = allowed, user.id
    else:
        db.add(RightSetting(school_id=school.id, role=role, user_id=uid, right=right, allowed=allowed, changed_by_id=user.id))
    who = R.ROLE_LABEL.get(role, role) if role else (db.get(User, uid).full_name if uid else "")
    label = right_label(right)
    db.add(AuditEntry(school_id=school.id, actor_id=user.id, action="rights",
                      what=f"{'reset' if allowed is None else 'gave' if allowed else 'took away'} “{label}” {'for' if allowed is None else 'to' if allowed else 'from'} {who}"))


def right_label(right: str) -> str:
    kind, _, lvl = right.partition(".")
    if kind == "private":
        return R.PRIVATE[lvl]["label"]
    if kind == "power":
        return R.POWERS[lvl]["label"]
    return f"{'See' if lvl == 'see' else 'Change'} {R.AREAS[kind]['label'].lower()}"


@router.put("/schools/{school_id}/rights/roles/{role}")
def set_role(school_id: uuid.UUID, role: str, data: RightIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    school = _school(db, user, school_id)
    if role not in R.SCHOOL_ROLES:
        raise not_found("Role")
    _check_change(db, user, school, data.right, R.RANK[role])
    _set(db, school, user, data.right, data.allowed, role=role)
    # Seeing an area comes with changing it; taking away seeing takes away changing.
    area, _, lvl = data.right.partition(".")
    if area in R.AREAS and data.allowed is not None:
        settings = list(db.scalars(select(RightSetting).where(RightSetting.school_id == school.id)))
        db.flush()
        have = role_rights(list(db.scalars(select(RightSetting).where(RightSetting.school_id == school.id))), role)
        if lvl == "change" and data.allowed and not R.AREAS[area].get("change_only") and f"{area}.see" not in have:
            _set(db, school, user, f"{area}.see", True, role=role)
        if lvl == "see" and not data.allowed and f"{area}.change" in have:
            _set(db, school, user, f"{area}.change", False, role=role)
        del settings
    db.commit()
    return page(school_id, user, db)


@router.post("/schools/{school_id}/rights/roles/{role}/reset")
def reset_role(school_id: uuid.UUID, role: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    school = _school(db, user, school_id)
    if role not in R.SCHOOL_ROLES:
        raise not_found("Role")
    _check_change(db, user, school, "school.see", R.RANK[role])
    for row in db.scalars(select(RightSetting).where(RightSetting.school_id == school.id, RightSetting.role == role, RightSetting.user_id.is_(None))):
        db.delete(row)
    db.add(AuditEntry(school_id=school.id, actor_id=user.id, action="rights", what=f"put {R.ROLE_LABEL[role]} back to the ready-made rights"))
    db.commit()
    return page(school_id, user, db)


@router.put("/schools/{school_id}/rights/people/{user_id}")
def set_person(school_id: uuid.UUID, user_id: uuid.UUID, data: RightIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    school = _school(db, user, school_id)
    target = db.get(User, user_id)
    if not target or not R.roles_at(target, school):
        raise not_found("Staff member")
    _check_change(db, user, school, data.right, max(R.RANK.get(r, 0) for r in R.roles_at(target, school)))
    _set(db, school, user, data.right, data.allowed, uid=user_id)
    db.commit()
    return page(school_id, user, db)


@router.get("/schools/{school_id}/rights/people/{user_id}")
def person_rights(school_id: uuid.UUID, user_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    school = _school(db, user, school_id)
    if not R.has(user, school, "rights.see"):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Rights are not open to you")
    target = db.get(User, user_id)
    if not target or not (R.roles_at(target, school) or R.owns(target, school)):
        raise not_found("Staff member")
    settings = [s for s in db.scalars(select(RightSetting).where(RightSetting.school_id == school.id, RightSetting.user_id == user_id))]
    return {**_person(db, school, user_id), "rights": sorted(R._computed(db, target, school)),
            "changes": [{"right": s.right, "allowed": s.allowed} for s in settings]}


class TitleIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    title: str = Field(min_length=2, max_length=40)


@router.put("/schools/{school_id}/head-title")
def set_title(school_id: uuid.UUID, data: TitleIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    school = _school(db, user, school_id)
    if R.acting(user) or not (R.has(user, school, "rights.change") or R.has(user, school, "school.change")):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the owner and the head of school can change this")
    school.head_title = data.title
    db.commit()
    return {"head_title": school.head_title}


# ---------- Asking for private records ----------

class RequestIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    right: str
    reason: str = Field(min_length=5, max_length=500)
    hours: int = Field(default=24, ge=1, le=24 * 14)


@router.post("/schools/{school_id}/access-requests", status_code=201)
def ask(school_id: uuid.UUID, data: RequestIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    school = _school(db, user, school_id)
    if R.acting(user):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Stop 'see as' first")
    if not data.right.startswith("private.") or data.right not in R.ALL:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Choose which private records you need")
    if R.has(user, school, data.right):
        raise HTTPException(status.HTTP_409_CONFLICT, "You can already open these records")
    if db.scalar(select(AccessGrant.id).where(AccessGrant.school_id == school.id, AccessGrant.user_id == user.id,
                                              AccessGrant.right == data.right, AccessGrant.status == "waiting")):
        raise HTTPException(status.HTTP_409_CONFLICT, "You have already asked. The principal will answer soon.")
    g = AccessGrant(school_id=school.id, user_id=user.id, right=data.right, reason=data.reason, hours=data.hours, status="waiting")
    db.add(g)
    label = R.PRIVATE[data.right.split(".")[1]]["label"].lower()
    R.notify_heads(db, school, f"{user.full_name} asks to open {label} for {hours_text(data.hours)}: “{data.reason}”",
                   kind="request", icon="key", link=f"#/school/{school.id}/rights", skip=user.id)
    db.add(AuditEntry(school_id=school.id, actor_id=user.id, action="grant", what=f"asked to open {label} for {hours_text(data.hours)}"))
    db.commit()
    return {"id": str(g.id), "status": g.status}


def hours_text(h: int) -> str:
    return f"{h} hour{'s' if h != 1 else ''}" if h < 24 else f"{h // 24} day{'s' if h >= 48 else ''}"


@router.get("/me/schools/{school_id}/access-requests")
def my_requests(school_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    school = _school(db, user, school_id)
    now = datetime.now(timezone.utc)
    rows = list(db.scalars(select(AccessGrant).where(AccessGrant.school_id == school.id, AccessGrant.user_id == user.id)
                           .order_by(AccessGrant.created_at.desc()).limit(10)))
    names = {u.id: u.full_name for u in db.scalars(select(User).where(User.id.in_({r.decided_by_id for r in rows if r.decided_by_id} | {user.id})))}
    return [grant_out(g, names, now) for g in rows]


class DecisionIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    decision: str = Field(pattern="^(approve|refuse|end)$")
    hours: int | None = Field(default=None, ge=1, le=24 * 14)
    note: str | None = Field(default=None, max_length=300)


@router.put("/access-requests/{grant_id}")
def decide(grant_id: uuid.UUID, data: DecisionIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    g = db.get(AccessGrant, grant_id)
    if not g:
        raise not_found("Request")
    school = _school(db, user, g.school_id)
    mine = g.user_id == user.id
    if not approves(user, school) and not (mine and data.decision == "end"):
        raise not_found("Request")
    if mine and data.decision != "end":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Someone else has to approve your own request")
    now = datetime.now(timezone.utc)
    label = R.PRIVATE[g.right.split(".")[1]]["label"].lower()
    if data.decision == "end":
        g.status, g.expires_at = "ended", now
        text = f"{user.full_name} ended access to {label}."
    elif g.status != "waiting":
        raise HTTPException(status.HTTP_409_CONFLICT, "This request has already been answered")
    elif data.decision == "approve":
        g.hours = data.hours or g.hours
        g.status, g.expires_at = "approved", now + timedelta(hours=g.hours)
        text = f"{user.full_name} approved your request to open {label} for {hours_text(g.hours)}."
    else:
        g.status = "refused"
        text = f"{user.full_name} said no to your request to open {label}."
    g.decided_by_id, g.decided_at, g.note = user.id, now, data.note or g.note
    if data.note:
        text += f" “{data.note}”"
    if g.user_id != user.id:
        db.add(Notice(user_id=g.user_id, school_id=school.id, kind="request", icon="key", text=text))
    who = db.get(User, g.user_id)
    db.add(AuditEntry(school_id=school.id, actor_id=user.id, action="grant",
                      what=f"{data.decision.replace('approve', 'approved').replace('refuse', 'refused').replace('end', 'ended')} {label} for {who.full_name if who else '?'}"))
    db.commit()
    return grant_out(g, {g.user_id: who.full_name if who else None, user.id: user.full_name}, now)


# ---------- See as ----------

@router.post("/schools/{school_id}/see-as/{user_id}")
def see_as(school_id: uuid.UUID, user_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    school = _school(db, user, school_id)
    if R.acting(user) or not R.has(user, school, "power.see_as"):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You can't use 'see as' here")
    target = db.get(User, user_id)
    if not target or target.id == user.id or not (R.roles_at(target, school) or R.owns(target, school)) or not target.is_active:
        raise not_found("Person")
    db.add(AuditEntry(school_id=school.id, actor_id=user.id, action="see_as", what=f"started seeing as {target.full_name}"))
    R.notify_heads(db, school, f"{user.full_name} is seeing the platform as {target.full_name} to help them (read-only, nothing private).",
                   kind="see_as", icon="eye", link=f"#/school/{school.id}/rights", skip=user.id)
    if rank_of(target, school) >= R.RANK["head"] and target.id not in R.school_roles_users(db, school.id, {"head", "head_of_school"}):
        db.add(Notice(user_id=target.id, school_id=school.id, kind="see_as", icon="eye",
                      text=f"{user.full_name} is seeing the platform as you to help (read-only, nothing private)."))
    db.commit()
    return {"access_token": create_access_token(str(target.id), actor_id=str(user.id), school_id=str(school.id), minutes=60),
            "name": target.full_name}


@router.post("/see-as/stop", status_code=204)
def stop(user: User = Depends(current_user), db: Session = Depends(get_db)):
    actor = R.acting(user)
    sid = user.__dict__.get("acting_school")
    if actor and sid:
        db.add(AuditEntry(school_id=sid, actor_id=actor.id, action="see_as", what=f"stopped seeing as {user.full_name}"))
        db.commit()


# ---------- The bell ----------

@router.get("/me/notices")
def notices(user: User = Depends(current_user), db: Session = Depends(get_db)):
    if R.acting(user):
        return {"unread": 0, "items": []}
    rows = list(db.scalars(select(Notice).where(Notice.user_id == user.id).order_by(Notice.created_at.desc()).limit(30)))
    unread = sum(1 for n in rows if not n.read_at)
    return {"unread": unread, "items": [{"id": str(n.id), "kind": n.kind, "icon": n.icon, "text": n.text, "link": n.link,
                                         "at": n.created_at.isoformat(), "read": bool(n.read_at)} for n in rows]}


@router.post("/me/notices/read", status_code=204)
def read_all(user: User = Depends(current_user), db: Session = Depends(get_db)):
    db.execute(update(Notice).where(Notice.user_id == user.id, Notice.read_at.is_(None)).values(read_at=datetime.now(timezone.utc)))
    db.commit()
