"""Complete every profile: parents send missing details and documents, the school checks and approves them,
and the office sees which classes have the most gaps and can ask those families for help."""
import uuid
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.access import check, not_found
from app.api.deps import current_user
from app.api.family import child_for
from app.api.student360 import ALLOWED, DOC_KINDS, MAX_DOC, access_for
from app.api.student_year import build_rows
from app.core import rights
from app.core.db import get_db
from app.models import (
    Notice, ProfileRequest, School, SchoolClass, Student, StudentContact, StudentDocument, StudentEvent, StudentGuardian, StudentHealth, User,
)
from app.models.people import StudentStatus

router = APIRouter(prefix="/api", tags=["profiles"])

# What a parent may fill in or correct, with the longest answer allowed.
FIELDS = {
    "date_of_birth": ("Date of birth", "about", 10), "nickname": ("Called at home", "about", 60), "home_address": ("Home address", "about", 300),
    "state_of_origin": ("State of origin", "about", 50), "lga": ("LGA", "about", 80), "home_town": ("Home town", "about", 80),
    "nationality": ("Nationality", "about", 40), "religion": ("Religion", "about", 30), "languages": ("Languages spoken", "about", 120),
    "previous_school": ("Previous school", "about", 150),
    "health.blood_group": ("Blood group", "health", 5), "health.genotype": ("Genotype", "health", 5), "health.allergies": ("Allergies", "health", 300),
    "health.conditions": ("Health conditions", "health", 300), "health.medications": ("Regular medicine", "health", 300),
    "health.diet": ("Food the child must not eat", "health", 200), "health.hospital": ("Family doctor or hospital", "health", 150),
    "photo": ("Photo", "photo", 400_000),
}
PARENT_DOCS = ("birth_certificate", "passport_photo", "previous_report", "immunisation", "medical", "other")


def current(db: Session, s: Student) -> dict:
    h = db.scalar(select(StudentHealth).where(StudentHealth.student_id == s.id))
    out = {}
    for k in FIELDS:
        if k.startswith("health."):
            out[k] = getattr(h, k[7:]) if h else None
        elif k == "photo":
            out[k] = s.photo
        else:
            v = getattr(s, k)
            out[k] = v.isoformat() if isinstance(v, date) else v
    return out


def office(db: Session, school_id: uuid.UUID) -> set[uuid.UUID]:
    return rights.school_roles_users(db, school_id, {"head", "vice_principal", "it_admin"})


# ---------- The family's side ----------

@router.get("/me/children/{student_id}/details")
def my_child_details(student_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    s, how = child_for(db, user, student_id)
    now = current(db, s)
    row = build_rows(db, s.school_id, [s])[0]
    pending = db.scalar(select(ProfileRequest).where(ProfileRequest.student_id == s.id, ProfileRequest.status == "pending").order_by(ProfileRequest.created_at.desc()))
    last = db.scalar(select(ProfileRequest).where(ProfileRequest.student_id == s.id, ProfileRequest.status == "done").order_by(ProfileRequest.decided_at.desc()))
    docs = list(db.scalars(select(StudentDocument).where(StudentDocument.student_id == s.id).order_by(StudentDocument.created_at)))
    return {"can_edit": how == "parent", "complete": row["complete"], "missing": row["missing"],
            "fields": [{"key": k, "label": l, "group": g, "max": m, "value": now[k] if k != "photo" else None, "has": bool(now[k])} for k, (l, g, m) in FIELDS.items()],
            "photo": s.photo,
            "pending": {"at": pending.created_at.isoformat(), "keys": list(pending.changes), "collectors": pending.collectors,
                        "values": {k: v for k, v in pending.changes.items() if k != "photo"}, "photo": pending.changes.get("photo")} if pending else None,
            "last": {"at": last.decided_at.isoformat() if last.decided_at else None, "approved": [FIELDS.get(k, (k,))[0] for k, v in (last.decisions or {}).items() if v == "approved"],
                     "rejected": [FIELDS.get(k, (k,))[0] for k, v in (last.decisions or {}).items() if v == "rejected"], "note": last.note} if last else None,
            "documents": [{"id": str(d.id), "kind": d.kind, "label": DOC_KINDS.get(d.kind, d.kind), "filename": d.filename, "checked": d.checked, "at": d.created_at.isoformat()} for d in docs],
            "doc_kinds": {k: DOC_KINDS.get(k, k.replace("_", " ").capitalize()) for k in PARENT_DOCS},
            "collectors": [{"name": c.name, "phone": c.phone, "relationship": c.relationship_label}
                           for c in db.scalars(select(StudentContact).where(StudentContact.student_id == s.id))]}


class Collector(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    phone: str | None = Field(default=None, max_length=30)
    relationship: str = Field(default="Family friend", max_length=40)


class DetailsIn(BaseModel):
    changes: dict[str, str | None] = Field(default_factory=dict)
    photo_thumb: str | None = Field(default=None, max_length=20_000)
    collectors: list[Collector] = Field(default_factory=list, max_length=6)


@router.post("/me/children/{student_id}/details")
def send_details(student_id: uuid.UUID, data: DetailsIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    s, how = child_for(db, user, student_id)
    if how != "parent" or rights.acting(user):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only a parent or guardian can send this")
    now = current(db, s)
    changes = {}
    for k, v in data.changes.items():
        if k not in FIELDS:
            continue
        v = (v or "").strip() or None
        if v and len(v) > FIELDS[k][2]:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"{FIELDS[k][0]} is too long")
        if k == "date_of_birth" and v:
            try:
                d = date.fromisoformat(v)
            except ValueError:
                raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Check the date of birth")
            if not date(1995, 1, 1) <= d <= date.today():
                raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Check the date of birth")
        if k == "photo" and v and not v.startswith("data:image/"):
            continue
        if v != now.get(k) and v is not None:
            changes[k] = v
    if "photo" in changes and data.photo_thumb and data.photo_thumb.startswith("data:image/"):
        changes["photo_thumb"] = data.photo_thumb
    collectors = [c.model_dump() for c in data.collectors]
    if not changes and not collectors:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Nothing has changed")
    r = db.scalar(select(ProfileRequest).where(ProfileRequest.student_id == s.id, ProfileRequest.status == "pending"))
    if r:
        r.changes = {**r.changes, **changes}
        r.collectors = (r.collectors or []) + collectors
        r.by_id = user.id
    else:
        r = ProfileRequest(school_id=s.school_id, student_id=s.id, by_id=user.id, changes=changes, collectors=collectors, decisions={})
        db.add(r)
        n = len(changes) + len(collectors)
        for uid in office(db, s.school_id):
            db.add(Notice(user_id=uid, school_id=s.school_id, kind="request", icon="user-check",
                          text=f"{user.full_name} sent {n} update{'s' if n > 1 else ''} to {s.full_name}'s details. Check them in Students → Complete profiles.",
                          link=f"#/school/{s.school_id}/students"))
    db.commit()
    return my_child_details(student_id, user, db)


@router.post("/me/children/{student_id}/documents", status_code=201)
def send_document(student_id: uuid.UUID, kind: str = Form(...), file: UploadFile = File(...), user: User = Depends(current_user), db: Session = Depends(get_db)):
    s, how = child_for(db, user, student_id)
    if how != "parent" or rights.acting(user):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only a parent or guardian can send this")
    if kind not in PARENT_DOCS:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Choose what the document is")
    ctype = (file.content_type or "").split(";")[0]
    if ctype not in ALLOWED or "word" in ctype:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Send a PDF or a photo (JPG or PNG)")
    blob = file.file.read(MAX_DOC + 1)
    if len(blob) > MAX_DOC:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "That file is bigger than 5 MB")
    if sum(1 for _ in db.scalars(select(StudentDocument.id).where(StudentDocument.student_id == s.id, StudentDocument.checked.is_(False)))) >= 6:
        raise HTTPException(status.HTTP_409_CONFLICT, "Six documents are already waiting for the school to look at them")
    db.add(StudentDocument(school_id=s.school_id, student_id=s.id, kind=kind, filename=(file.filename or "document")[:200], content_type=ctype,
                           size=len(blob), data=blob, uploaded_by_id=user.id, checked=False))
    db.commit()
    return my_child_details(student_id, user, db)


# ---------- The school's side ----------

def need_school(db: Session, user: User, school_id: uuid.UUID) -> School:
    s = db.get(School, school_id)
    if not s:
        raise not_found("School")
    check(user, s, "students")
    return s


def shown(k: str, v):
    if k == "photo":
        return "New photo" if v else None
    return v


@router.get("/schools/{school_id}/profiles")
def overview(school_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    school = need_school(db, user, school_id)
    studs = list(db.scalars(select(Student).where(Student.school_id == school_id, Student.status == StudentStatus.active)))
    rows = build_rows(db, school_id, studs)
    by_class = defaultdict(list)
    for r in rows:
        by_class[r["class_id"]].append(r)
    classes = {str(c.id): c for c in db.scalars(select(SchoolClass).where(SchoolClass.id.in_([s.class_id for s in studs if s.class_id] or [uuid.uuid4()])))}
    out_classes = []
    for cid, rs in by_class.items():
        c = classes.get(cid)
        miss = Counter(m for r in rs for m in r["missing"])
        out_classes.append({"class_id": cid, "name": c.name if c else "No class", "order": (c.level_order, c.arm) if c else (999, ""), "students": len(rs),
                            "complete": round(sum(r["complete"] for r in rs) / len(rs)), "full": sum(1 for r in rs if r["complete"] == 100),
                            "missing": miss.most_common(4), "no_photo": sum(1 for r in rs if "photo" in r["missing"])})
    out_classes.sort(key=lambda x: x["order"])
    for c in out_classes:
        c.pop("order")
    miss = Counter(m for r in rows for m in r["missing"])
    health_ok = rights.has(user, school, "private.health", db) and not rights.acting(user)
    reqs = []
    for q in db.scalars(select(ProfileRequest).where(ProfileRequest.school_id == school_id, ProfileRequest.status == "pending").order_by(ProfileRequest.created_at)):
        s = db.get(Student, q.student_id)
        if not s:
            continue
        a = access_for(db, user, s)
        now = current(db, s)
        items = []
        for k, v in q.changes.items():
            if k == "photo_thumb" or k not in FIELDS:
                continue
            is_health = k.startswith("health.")
            may = a.edit and (not is_health or a.health)
            items.append({"key": k, "label": FIELDS[k][0], "health": is_health, "may": may,
                          "old": shown(k, now.get(k)) if (may or not is_health) else "🔒", "new": (v if k != "photo" else None) if may or not is_health else "🔒",
                          "photo": v if k == "photo" and may else None, "decided": (q.decisions or {}).get(k)})
        by = db.get(User, q.by_id) if q.by_id else None
        reqs.append({"id": str(q.id), "student": {"id": str(s.id), "name": s.full_name, "class_name": s.school_class.name if s.school_class else None, "thumb": s.photo_thumb},
                     "by": by.full_name if by else None, "at": q.created_at.isoformat(), "items": items, "collectors": q.collectors or []})
    docs = []
    for d, s in db.execute(select(StudentDocument, Student).join(Student, Student.id == StudentDocument.student_id)
                           .where(StudentDocument.school_id == school_id, StudentDocument.checked.is_(False)).order_by(StudentDocument.created_at)):
        by = db.get(User, d.uploaded_by_id) if d.uploaded_by_id else None
        docs.append({"id": str(d.id), "student_id": str(s.id), "student": s.full_name, "class_name": s.school_class.name if s.school_class else None,
                     "kind": d.kind, "label": DOC_KINDS.get(d.kind, d.kind), "filename": d.filename, "size": d.size, "by": by.full_name if by else None, "at": d.created_at.isoformat()})
    families = sum(1 for s in studs if s.guardians)
    return {"students": len(rows), "complete": round(sum(r["complete"] for r in rows) / len(rows)) if rows else 0, "full": sum(1 for r in rows if r["complete"] == 100),
            "missing": miss.most_common(), "classes": out_classes, "requests": reqs, "documents": docs, "health_ok": health_ok, "families": families}


class DecideIn(BaseModel):
    approve: list[str] = Field(default_factory=list)
    reject: list[str] = Field(default_factory=list)
    collectors: bool | None = None          # True: add the people who may collect; False: don't
    note: str | None = Field(default=None, max_length=300)


@router.post("/profile-requests/{request_id}/decide")
def decide(request_id: uuid.UUID, data: DecideIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    q = db.get(ProfileRequest, request_id)
    if not q or q.status != "pending":
        raise not_found("Request")
    school = need_school(db, user, q.school_id)
    s = db.get(Student, q.student_id)
    a = access_for(db, user, s)
    if not a.edit:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only people who can change students can approve this")
    decisions = dict(q.decisions or {})
    health = db.scalar(select(StudentHealth).where(StudentHealth.student_id == s.id))
    applied = []
    for k in data.approve + data.reject:
        if k not in q.changes or k == "photo_thumb":
            continue
        if k.startswith("health.") and not a.health:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Health changes need the nurse or someone with the medical records right")
        ok = k in data.approve
        decisions[k] = "approved" if ok else "rejected"
        if not ok:
            continue
        v = q.changes[k]
        if k.startswith("health."):
            if not health:
                health = StudentHealth(student_id=s.id)
                db.add(health)
            setattr(health, k[7:], v)
            health.updated_by_id = user.id
            rights.use_private(db, user, school, "health", s.full_name)
        elif k == "photo":
            s.photo, s.photo_thumb = v, q.changes.get("photo_thumb")
        elif k == "date_of_birth":
            s.date_of_birth = date.fromisoformat(v)
        else:
            setattr(s, k, v)
        applied.append(FIELDS[k][0])
    if data.collectors is not None and q.collectors:
        if data.collectors:
            for c in q.collectors:
                db.add(StudentContact(student_id=s.id, name=c["name"], phone=c.get("phone"), relationship_label=c.get("relationship") or "Family friend"))
            applied.append("people who may collect")
        decisions["collectors"] = "approved" if data.collectors else "rejected"
    q.decisions = decisions
    if data.note:
        q.note = data.note
    left = [k for k in q.changes if k != "photo_thumb" and k in FIELDS and k not in decisions] + (["collectors"] if q.collectors and "collectors" not in decisions else [])
    if not left:
        q.status, q.decided_by_id, q.decided_at = "done", user.id, datetime.now(timezone.utc)
        rejected = [FIELDS.get(k, ("people who may collect",))[0] for k, v in decisions.items() if v == "rejected"]
        if q.by_id:
            text = f"The school has updated {s.first_name}'s details." + (f" Not changed: {', '.join(rejected)}." if rejected else "") + (f" “{q.note}”" if q.note else "")
            db.add(Notice(user_id=q.by_id, school_id=s.school_id, kind="info", icon="circle-check", text=text[:400], link=f"#/child/{s.id}"))
    elif any(k.startswith("health.") for k in left) and not a.health:
        # Send what's left to the people who may see health records.
        from app.api.ops import desk_members
        for uid in desk_members(db, s.school_id, "sickbay"):
            db.add(Notice(user_id=uid, school_id=s.school_id, kind="request", icon="heart-pulse",
                          text=f"Health details from {s.full_name}'s parent are waiting for you. Students → Complete profiles.", link=f"#/school/{s.school_id}/students"))
    if applied:
        db.add(StudentEvent(student_id=s.id, kind="profile", text=f"Details from the family added: {', '.join(applied)}", by_id=user.id))
    db.commit()
    return overview(q.school_id, user, db)


class DocIn(BaseModel):
    keep: bool


@router.post("/student-documents/{doc_id}/checked")
def doc_checked(doc_id: uuid.UUID, data: DocIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    d = db.get(StudentDocument, doc_id)
    if not d:
        raise not_found("Document")
    need_school(db, user, d.school_id)
    s = db.get(Student, d.student_id)
    if not access_for(db, user, s).edit:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only people who can change students can do this")
    if data.keep:
        d.checked = True
    else:
        if d.uploaded_by_id:
            db.add(Notice(user_id=d.uploaded_by_id, school_id=d.school_id, kind="info", icon="file",
                          text=f"The school could not use the {DOC_KINDS.get(d.kind, d.kind).lower()} you sent for {s.first_name}. Please send a clearer copy."))
        db.delete(d)
    db.commit()
    return {"ok": True}


class AskIn(BaseModel):
    class_id: uuid.UUID | None = None
    below: int = Field(default=80, ge=10, le=100)


@router.post("/schools/{school_id}/profiles/ask")
def ask_families(school_id: uuid.UUID, data: AskIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Ask the families of students whose profiles are not complete to fill in the gaps from their phone."""
    need_school(db, user, school_id)
    if rights.acting(user):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Nothing can be changed while seeing as someone else")
    q = select(Student).where(Student.school_id == school_id, Student.status == StudentStatus.active)
    if data.class_id:
        q = q.where(Student.class_id == data.class_id)
    studs = list(db.scalars(q))
    rows = {r["id"]: r for r in build_rows(db, school_id, studs)}
    since = datetime.now(timezone.utc) - timedelta(days=3)
    told, skipped, no_login = set(), 0, 0
    for s in studs:
        r = rows[str(s.id)]
        if r["complete"] >= data.below:
            continue
        # Things only the office can fill in (house, class, bed) are left out of the request.
        theirs = [m for m in r["missing"] if m not in ("class", "house", "main contact", "date admitted")]
        if not theirs:
            continue
        link = f"#/child/{s.id}"
        for g in s.guardians:
            if not g.user.last_login_at:
                no_login += 1
            if db.scalar(select(Notice.id).where(Notice.user_id == g.user_id, Notice.link == link, Notice.kind == "request", Notice.created_at >= since)):
                skipped += 1
                continue
            db.add(Notice(user_id=g.user_id, school_id=school_id, kind="request", icon="clipboard-list",
                          text=f"Please help us complete {s.first_name}'s school record. Missing: {', '.join(theirs[:4])}. Open {s.first_name}'s page and choose “Details”.", link=link))
            told.add(g.user_id)
    db.commit()
    return {"families": len(told), "skipped": skipped, "never_logged_in": no_login}
