"""A staff member's full record: personal details, qualifications, TRCN, documents and (private) pay details.

Who sees what:
- the people who run the school (owner, principal, vice principals, IT team) see and edit everything except pay;
- staff see and edit their own record (personal details, qualifications, documents), but not their pay;
- pay and bank details: only the owner, the principal and the bursar.
"""
import uuid
from datetime import date

from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.access import not_found
from app.api.deps import current_user, owned_group_ids
from app.api.electives import runs_school
from app.api.staff import STAFF_ROLES
from app.core.db import get_db
from app.core.phone import normalize_phone
from app.models import Branch, Membership, Role, School, StaffDocument, StaffProfile, StaffQualification, User

router = APIRouter(prefix="/api", tags=["staff records"])

DOC_KINDS = {
    "cv": "CV", "appointment_letter": "Appointment letter", "certificate": "Certificate", "trcn": "TRCN certificate",
    "id": "Means of ID", "nysc": "NYSC certificate", "medical": "Medical report", "other": "Other",
}
REQUIRED_DOCS = ["cv", "appointment_letter", "certificate", "id"]
MAX_DOC = 5 * 1024 * 1024
ALLOWED_TYPES = {"application/pdf", "image/jpeg", "image/png", "image/webp",
                 "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"}


# ---------- Who may do what ----------

def _branch(db: Session, school_id: uuid.UUID) -> Branch:
    b = db.scalar(select(Branch).where(Branch.school_id == school_id).order_by(Branch.created_at))
    if not b:
        raise not_found("School")
    return b


def is_staff(db: Session, school_id: uuid.UUID, user_id: uuid.UUID) -> bool:
    return bool(db.scalar(select(Membership.id).where(Membership.user_id == user_id, Membership.school_id == school_id,
                                                      Membership.role.in_(STAFF_ROLES))))


def sees_pay(user: User, school: School) -> bool:
    if school.group_id in owned_group_ids(user):
        return True
    return any(m.school_id == school.id and m.role in (Role.head, Role.bursar) for m in user.memberships)


def access(db: Session, user: User, school_id: uuid.UUID, person_id: uuid.UUID) -> tuple[School, bool, bool]:
    """Returns (school, may_edit, sees_pay). Raises not found if the user may not see this record."""
    school = db.get(School, school_id)
    if not school or not is_staff(db, school_id, person_id):
        raise not_found("Staff member")
    runs = runs_school(user, _branch(db, school_id))
    pay = sees_pay(user, school)
    if runs or user.id == person_id:
        return school, True, pay
    if pay:  # the bursar: may read the record for pay purposes
        return school, False, pay
    raise not_found("Staff member")


def _profile(db: Session, school_id: uuid.UUID, user_id: uuid.UUID) -> StaffProfile:
    p = db.scalar(select(StaffProfile).where(StaffProfile.school_id == school_id, StaffProfile.user_id == user_id))
    if not p:
        p = StaffProfile(school_id=school_id, user_id=user_id)
        db.add(p)
        db.flush()
    return p


# ---------- Reading ----------

class QualOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    title: str
    institution: str | None
    year: int | None
    kind: str


class DocOut(BaseModel):
    id: uuid.UUID
    kind: str
    kind_label: str
    filename: str
    content_type: str
    size: int
    uploaded_on: date


class CheckItem(BaseModel):
    key: str
    label: str
    done: bool


class Pay(BaseModel):
    grade_level: str | None
    step: str | None
    bank_name: str | None
    account_number: str | None
    account_name: str | None


class Record(BaseModel):
    user_id: uuid.UUID
    school_id: uuid.UUID
    school_name: str
    full_name: str
    phone: str | None
    email: str | None
    roles: list[Role]
    title: str | None
    gender: str | None
    job_title: str | None
    department_name: str | None
    unit_name: str | None
    staff_no: str | None
    employment_type: str
    date_joined: date | None
    teaching: bool
    photo: str | None
    date_of_birth: date | None
    address: str | None
    state_of_origin: str | None
    lga: str | None
    marital_status: str | None
    religion: str | None
    next_of_kin_name: str | None
    next_of_kin_relationship: str | None
    next_of_kin_phone: str | None
    next_of_kin_address: str | None
    trcn_number: str | None
    trcn_expiry: date | None
    subjects_trained: list[str]
    qualifications: list[QualOut]
    documents: list[DocOut]
    pay: Pay | None
    may_edit: bool
    sees_pay: bool
    is_self: bool
    checklist: list[CheckItem]


def checklist(p: StaffProfile, quals: int, docs: set[str], with_pay: bool) -> list[CheckItem]:
    items = [
        CheckItem(key="photo", label="Photo", done=bool(p.photo)),
        CheckItem(key="dob", label="Date of birth", done=bool(p.date_of_birth)),
        CheckItem(key="address", label="Address", done=bool(p.address)),
        CheckItem(key="origin", label="State of origin", done=bool(p.state_of_origin)),
        CheckItem(key="kin", label="Next of kin", done=bool(p.next_of_kin_name and p.next_of_kin_phone)),
        CheckItem(key="qualification", label="Qualifications", done=quals > 0),
    ]
    if p.teaching:
        items.append(CheckItem(key="trcn", label="TRCN number", done=bool(p.trcn_number)))
    items += [CheckItem(key=f"doc:{k}", label=DOC_KINDS[k], done=k in docs) for k in REQUIRED_DOCS]
    if with_pay:
        items.append(CheckItem(key="bank", label="Bank details", done=bool(p.bank_name and p.account_number)))
    return items


def record(db: Session, viewer: User, school: School, person_id: uuid.UUID, may_edit: bool, pay: bool) -> Record:
    u = db.get(User, person_id)
    p = _profile(db, school.id, person_id)
    quals = list(db.scalars(select(StaffQualification).where(StaffQualification.school_id == school.id,
                                                             StaffQualification.user_id == person_id).order_by(StaffQualification.year.desc().nulls_last())))
    docs = list(db.scalars(select(StaffDocument).where(StaffDocument.school_id == school.id, StaffDocument.user_id == person_id)
                           .order_by(StaffDocument.created_at)))
    roles = sorted({m.role for m in u.memberships if m.school_id == school.id and m.role in STAFF_ROLES}, key=lambda r: r.value)
    return Record(
        user_id=u.id, school_id=school.id, school_name=school.name, full_name=u.full_name, phone=u.phone, email=u.email,
        roles=roles, title=p.title, gender=p.gender.value if p.gender else None, job_title=p.job_title,
        department_name=p.department.name if p.department else None, unit_name=p.unit.name if p.unit else None,
        staff_no=p.staff_no, employment_type=p.employment_type.value, date_joined=p.date_joined, teaching=p.teaching,
        photo=p.photo, date_of_birth=p.date_of_birth, address=p.address, state_of_origin=p.state_of_origin, lga=p.lga,
        marital_status=p.marital_status, religion=p.religion, next_of_kin_name=p.next_of_kin_name,
        next_of_kin_relationship=p.next_of_kin_relationship, next_of_kin_phone=p.next_of_kin_phone,
        next_of_kin_address=p.next_of_kin_address, trcn_number=p.trcn_number, trcn_expiry=p.trcn_expiry,
        subjects_trained=list(p.subjects_trained or []),
        qualifications=[QualOut.model_validate(q) for q in quals],
        documents=[DocOut(id=d.id, kind=d.kind, kind_label=DOC_KINDS.get(d.kind, d.kind), filename=d.filename,
                          content_type=d.content_type, size=d.size, uploaded_on=d.created_at.date()) for d in docs],
        pay=Pay(grade_level=p.grade_level, step=p.step, bank_name=p.bank_name, account_number=p.account_number,
                account_name=p.account_name) if pay else None,
        may_edit=may_edit, sees_pay=pay, is_self=viewer.id == person_id,
        checklist=checklist(p, len(quals), {d.kind for d in docs}, pay),
    )


@router.get("/schools/{school_id}/staff/{user_id}/record", response_model=Record)
def get_record(school_id: uuid.UUID, user_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    school, may_edit, pay = access(db, user, school_id, user_id)
    r = record(db, user, school, user_id, may_edit, pay)
    db.commit()
    return r


# ---------- Editing ----------

class PersonalIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    photo: str | None = Field(default=None, max_length=400_000)
    date_of_birth: date | None = None
    address: str | None = Field(default=None, max_length=300)
    state_of_origin: str | None = Field(default=None, max_length=50)
    lga: str | None = Field(default=None, max_length=80)
    marital_status: str | None = Field(default=None, max_length=20)
    religion: str | None = Field(default=None, max_length=30)
    next_of_kin_name: str | None = Field(default=None, max_length=200)
    next_of_kin_relationship: str | None = Field(default=None, max_length=40)
    next_of_kin_phone: str | None = Field(default=None, max_length=32)
    next_of_kin_address: str | None = Field(default=None, max_length=300)
    trcn_number: str | None = Field(default=None, max_length=40)
    trcn_expiry: date | None = None
    subjects_trained: list[str] | None = None


@router.patch("/schools/{school_id}/staff/{user_id}/record", response_model=Record)
def update_personal(school_id: uuid.UUID, user_id: uuid.UUID, data: PersonalIn,
                    user: User = Depends(current_user), db: Session = Depends(get_db)):
    school, may_edit, pay = access(db, user, school_id, user_id)
    if not may_edit:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You can't change this record")
    if data.photo and not data.photo.startswith("data:image/"):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "The photo must be an image")
    if data.date_of_birth and data.date_of_birth > date.today():
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Date of birth can't be in the future")
    p = _profile(db, school_id, user_id)
    for k, v in data.model_dump(exclude_unset=True).items():
        if k == "next_of_kin_phone":
            v = normalize_phone(v) if v else None
        if k == "subjects_trained":
            v = sorted({s.strip() for s in (v or []) if s.strip()})
        setattr(p, k, v if v != "" else None)
    db.commit()
    return record(db, user, school, user_id, may_edit, pay)


class PayIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    grade_level: str | None = Field(default=None, max_length=20)
    step: str | None = Field(default=None, max_length=10)
    bank_name: str | None = Field(default=None, max_length=80)
    account_number: str | None = Field(default=None, max_length=20)
    account_name: str | None = Field(default=None, max_length=200)


@router.put("/schools/{school_id}/staff/{user_id}/pay", response_model=Record)
def update_pay(school_id: uuid.UUID, user_id: uuid.UUID, data: PayIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    school, may_edit, pay = access(db, user, school_id, user_id)
    if not pay:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the owner, principal and bursar can change pay details")
    if data.account_number and not data.account_number.isdigit():
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "The account number should be digits only (10 for NUBAN)")
    p = _profile(db, school_id, user_id)
    for k, v in data.model_dump().items():
        setattr(p, k, v or None)
    db.commit()
    return record(db, user, school, user_id, may_edit, pay)


class QualIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    title: str = Field(min_length=2, max_length=150)
    institution: str | None = Field(default=None, max_length=200)
    year: int | None = Field(default=None, ge=1950, le=2100)
    kind: str = Field(default="degree", max_length=30)


@router.post("/schools/{school_id}/staff/{user_id}/qualifications", response_model=Record, status_code=201)
def add_qualification(school_id: uuid.UUID, user_id: uuid.UUID, data: QualIn,
                      user: User = Depends(current_user), db: Session = Depends(get_db)):
    school, may_edit, pay = access(db, user, school_id, user_id)
    if not may_edit:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You can't change this record")
    db.add(StaffQualification(school_id=school_id, user_id=user_id, **data.model_dump()))
    p = _profile(db, school_id, user_id)
    if not p.qualification:
        p.qualification = data.title[:100]
    db.commit()
    return record(db, user, school, user_id, may_edit, pay)


@router.delete("/schools/{school_id}/staff/{user_id}/qualifications/{qual_id}", response_model=Record)
def delete_qualification(school_id: uuid.UUID, user_id: uuid.UUID, qual_id: uuid.UUID,
                         user: User = Depends(current_user), db: Session = Depends(get_db)):
    school, may_edit, pay = access(db, user, school_id, user_id)
    q = db.get(StaffQualification, qual_id)
    if not may_edit or not q or q.user_id != user_id or q.school_id != school_id:
        raise not_found("Qualification")
    db.delete(q)
    db.commit()
    return record(db, user, school, user_id, may_edit, pay)


# ---------- Documents ----------

@router.post("/schools/{school_id}/staff/{user_id}/documents", response_model=Record, status_code=201)
def upload_document(school_id: uuid.UUID, user_id: uuid.UUID, kind: str = Form(...), file: UploadFile = File(...),
                    user: User = Depends(current_user), db: Session = Depends(get_db)):
    school, may_edit, pay = access(db, user, school_id, user_id)
    if not may_edit:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You can't change this record")
    if kind not in DOC_KINDS:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Choose what kind of document this is")
    data = file.file.read(MAX_DOC + 1)
    if len(data) > MAX_DOC:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "The file is bigger than 5 MB. Scan at a lower quality or save as PDF.")
    ctype = (file.content_type or "").split(";")[0]
    if ctype not in ALLOWED_TYPES:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Upload a PDF, a photo (JPG or PNG) or a Word file")
    db.add(StaffDocument(school_id=school_id, user_id=user_id, kind=kind, filename=(file.filename or "document")[:200],
                         content_type=ctype, size=len(data), data=data, uploaded_by_id=user.id))
    db.commit()
    return record(db, user, school, user_id, may_edit, pay)


@router.get("/schools/{school_id}/staff/{user_id}/documents/{doc_id}")
def download_document(school_id: uuid.UUID, user_id: uuid.UUID, doc_id: uuid.UUID,
                      user: User = Depends(current_user), db: Session = Depends(get_db)):
    access(db, user, school_id, user_id)
    d = db.get(StaffDocument, doc_id)
    if not d or d.user_id != user_id or d.school_id != school_id:
        raise not_found("Document")
    safe = "".join(c for c in d.filename if c.isalnum() or c in " ._-") or "document"
    return Response(d.data, media_type=d.content_type, headers={"Content-Disposition": f'inline; filename="{safe}"'})


@router.delete("/schools/{school_id}/staff/{user_id}/documents/{doc_id}", response_model=Record)
def delete_document(school_id: uuid.UUID, user_id: uuid.UUID, doc_id: uuid.UUID,
                    user: User = Depends(current_user), db: Session = Depends(get_db)):
    school, may_edit, pay = access(db, user, school_id, user_id)
    d = db.get(StaffDocument, doc_id)
    if not may_edit or not d or d.user_id != user_id or d.school_id != school_id:
        raise not_found("Document")
    db.delete(d)
    db.commit()
    return record(db, user, school, user_id, may_edit, pay)


# ---------- Whole-school view: who is missing what; ID card data ----------

class Missing(BaseModel):
    key: str
    label: str
    missing: int
    names: list[str]


class Completeness(BaseModel):
    staff: int
    complete: int
    items: list[Missing]
    percent: dict[str, int]   # user id -> % complete


@router.get("/schools/{school_id}/staff-records/completeness", response_model=Completeness)
def completeness(school_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    school = db.get(School, school_id)
    if not school or not runs_school(user, _branch(db, school_id)):
        raise not_found("School")
    ids = set(db.scalars(select(Membership.user_id).where(Membership.school_id == school_id, Membership.role.in_(STAFF_ROLES))))
    pay = sees_pay(user, school)
    quals: dict = {}
    for q in db.scalars(select(StaffQualification.user_id).where(StaffQualification.school_id == school_id)):
        quals[q] = quals.get(q, 0) + 1
    docs: dict = {}
    for uid, kind in db.execute(select(StaffDocument.user_id, StaffDocument.kind).where(StaffDocument.school_id == school_id)):
        docs.setdefault(uid, set()).add(kind)
    agg: dict[str, Missing] = {}
    percent = {}
    complete = 0
    for uid in ids:
        p = _profile(db, school_id, uid)
        items = checklist(p, quals.get(uid, 0), docs.get(uid, set()), pay)
        done = sum(1 for i in items if i.done)
        percent[str(uid)] = round(100 * done / len(items))
        complete += done == len(items)
        for i in items:
            m = agg.setdefault(i.key, Missing(key=i.key, label=i.label, missing=0, names=[]))
            if not i.done:
                m.missing += 1
                m.names.append(db.get(User, uid).full_name)
    db.commit()
    for m in agg.values():
        m.names.sort()
    return Completeness(staff=len(ids), complete=complete, items=sorted(agg.values(), key=lambda m: -m.missing), percent=percent)


class Card(BaseModel):
    user_id: uuid.UUID
    full_name: str
    title: str | None
    job_title: str | None
    department_name: str | None
    staff_no: str | None
    photo: str | None
    phone: str | None
    code: str


class Cards(BaseModel):
    school_name: str
    motto: str | None
    logo: str | None
    colour: str | None
    address: str | None
    phone: str | None
    cards: list[Card]


@router.get("/schools/{school_id}/staff-cards", response_model=Cards)
def staff_cards(school_id: uuid.UUID, ids: str | None = None, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """What goes on staff ID cards. The QR code holds a short code used later for signing in."""
    school = db.get(School, school_id)
    if not school:
        raise not_found("School")
    wanted = {uuid.UUID(x) for x in ids.split(",") if x} if ids else None
    if not runs_school(user, _branch(db, school_id)):
        wanted = {user.id}  # staff may print their own card only
    staff_ids = set(db.scalars(select(Membership.user_id).where(Membership.school_id == school_id, Membership.role.in_(STAFF_ROLES))))
    if wanted:
        staff_ids &= wanted
    cards = []
    for uid in staff_ids:
        u, p = db.get(User, uid), _profile(db, school_id, uid)
        cards.append(Card(user_id=uid, full_name=u.full_name, title=p.title, job_title=p.job_title,
                          department_name=p.department.name if p.department else None, staff_no=p.staff_no, photo=p.photo,
                          phone=u.phone, code=f"SP1:S:{school.id.hex[:8]}:{uid.hex}"))
    db.commit()
    cards.sort(key=lambda c: c.full_name.lower())
    return Cards(school_name=school.name, motto=school.motto, logo=school.logo, colour=school.colour,
                 address=getattr(school, "address", None), phone=getattr(school, "phone", None), cards=cards)
