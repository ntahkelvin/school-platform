"""Units: smaller teams inside a department (Chemistry unit, Guidance and Counselling unit...)."""
import uuid

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.access import not_found, owned_school
from app.api.deps import current_user
from app.core.db import get_db
from app.models import Department, DepartmentKind, StaffProfile, Subject, Unit, User

router = APIRouter(prefix="/api", tags=["units"])

# Usual units, by department. Teaching units list the subjects they cover.
STANDARD_UNITS: dict[str, list[tuple[str, list[str]]]] = {
    "sciences": [("Biology", ["Biology", "Basic Science"]), ("Chemistry", ["Chemistry"]), ("Physics", ["Physics"]),
                 ("Agricultural Science", ["Agricultural Science"]), ("Computer Studies", ["Computer Studies"]),
                 ("Physical and Health Education", ["Physical and Health Education"])],
    "mathematics": [("Mathematics", ["Mathematics"]), ("Further Mathematics", ["Further Mathematics"])],
    "english and languages": [("English Language", ["English Language"]), ("Literature", ["Literature in English"]),
                              ("French", ["French"]), ("Nigerian Languages", ["Igbo", "Yoruba", "Hausa"])],
    "arts and humanities": [("Religious Studies", ["Christian Religious Studies", "Islamic Religious Studies"]),
                            ("Social Studies and Civic Education", ["Social Studies", "Civic Education"]),
                            ("Government and History", ["Government", "History"]), ("Geography", ["Geography"]),
                            ("Creative Arts and Music", ["Cultural and Creative Arts", "Music"])],
    "commercial": [("Economics", ["Economics"]), ("Accounting", ["Financial Accounting"]),
                   ("Commerce and Business Studies", ["Commerce", "Business Studies"])],
    "technical and vocational": [("Basic Technology", ["Basic Technology"]), ("Technical Drawing", ["Technical Drawing"]),
                                 ("Home Economics", ["Home Economics"])],
    "nursery and primary": [("Nursery", []), ("Lower Primary", []), ("Upper Primary", [])],
    "administration": [("Principal's Office", []), ("Examinations and Records", []), ("Registry", [])],
    "guidance and counselling": [("Guidance and Counselling", []), ("Career Guidance", []), ("Student Welfare", [])],
    "bursary": [("Accounts", []), ("Fees Collection", []), ("Store", [])],
    "boarding": [("Boys' Boarding", []), ("Girls' Boarding", [])],
    "ict": [("Systems and Network", []), ("Computer Laboratory", [])],
    "sick bay": [("Clinic", [])],
    "security": [("Gate", []), ("Patrol", [])],
    "maintenance and works": [("Electrical", []), ("Plumbing", []), ("Grounds", [])],
    "kitchen and catering": [("Kitchen", []), ("Dining", [])],
    "library": [("Library", [])],
    "admissions": [("Admissions", [])],
    "transport": [("Transport", [])],
}


class UnitIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    department_id: uuid.UUID
    name: str = Field(min_length=2, max_length=100)
    teaching: bool = True
    description: str | None = Field(default=None, max_length=500)
    head_user_id: uuid.UUID | None = None


class UnitOut(BaseModel):
    id: uuid.UUID
    department_id: uuid.UUID
    department_name: str
    name: str
    teaching: bool
    description: str | None
    head_user_id: uuid.UUID | None
    head_name: str | None
    subject_ids: list[uuid.UUID]
    member_ids: list[uuid.UUID]


def unit_list(db: Session, school_id: uuid.UUID) -> list[UnitOut]:
    units = list(db.scalars(select(Unit).join(Department).where(Unit.school_id == school_id)
                            .order_by(Department.kind, Department.name, Unit.name)))
    subj: dict = {}
    for s in db.scalars(select(Subject).where(Subject.school_id == school_id, Subject.unit_id.is_not(None))):
        subj.setdefault(s.unit_id, []).append(s.id)
    members: dict = {}
    for p in db.scalars(select(StaffProfile).where(StaffProfile.school_id == school_id, StaffProfile.unit_id.is_not(None))):
        members.setdefault(p.unit_id, []).append(p.user_id)
    return [UnitOut(id=u.id, department_id=u.department_id, department_name=u.department.name, name=u.name,
                    teaching=u.teaching, description=u.description, head_user_id=u.head_user_id, head_name=u.head_name,
                    subject_ids=subj.get(u.id, []), member_ids=members.get(u.id, [])) for u in units]


def _check(db: Session, school_id: uuid.UUID, data: UnitIn, unit_id: uuid.UUID | None = None) -> Department:
    d = db.get(Department, data.department_id)
    if not d or d.school_id != school_id:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Choose a department of this school")
    clash = db.scalar(select(Unit).where(Unit.department_id == d.id, func.lower(Unit.name) == data.name.lower()))
    if clash and clash.id != unit_id:
        raise HTTPException(status.HTTP_409_CONFLICT, f"{d.name} already has a {data.name} unit")
    return d


@router.get("/schools/{school_id}/units", response_model=list[UnitOut])
def list_units(school_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    owned_school(db, user, school_id)
    return unit_list(db, school_id)


@router.post("/schools/{school_id}/units", response_model=list[UnitOut], status_code=201)
def add_unit(school_id: uuid.UUID, data: UnitIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    owned_school(db, user, school_id)
    _check(db, school_id, data)
    db.add(Unit(school_id=school_id, **data.model_dump()))
    db.commit()
    return unit_list(db, school_id)


def _own_unit(db: Session, user: User, unit_id: uuid.UUID) -> Unit:
    u = db.get(Unit, unit_id)
    if not u:
        raise not_found("Unit")
    owned_school(db, user, u.school_id)
    return u


@router.patch("/units/{unit_id}", response_model=list[UnitOut])
def update_unit(unit_id: uuid.UUID, data: UnitIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    u = _own_unit(db, user, unit_id)
    _check(db, u.school_id, data, u.id)
    for k, v in data.model_dump().items():
        setattr(u, k, v)
    db.commit()
    return unit_list(db, u.school_id)


@router.delete("/units/{unit_id}", status_code=204)
def delete_unit(unit_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    u = _own_unit(db, user, unit_id)
    db.delete(u)
    db.commit()
    return Response(status_code=204)


@router.post("/schools/{school_id}/units/add-standard", response_model=list[UnitOut])
def add_standard_units(school_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Adds the usual units to the departments the school has (and a Guidance and Counselling
    department if there isn't one), linking teaching units to their subjects."""
    owned_school(db, user, school_id)
    depts = {d.name.lower(): d for d in db.scalars(select(Department).where(Department.school_id == school_id))}
    if "guidance and counselling" not in depts:
        d = Department(school_id=school_id, name="Guidance and Counselling", kind=DepartmentKind.non_academic)
        db.add(d)
        db.flush()
        depts["guidance and counselling"] = d
    subjects = {s.name.lower(): s for s in db.scalars(select(Subject).where(Subject.school_id == school_id))}
    for key, units in STANDARD_UNITS.items():
        d = depts.get(key)
        if not d:
            continue
        have = {u.name.lower(): u for u in db.scalars(select(Unit).where(Unit.department_id == d.id))}
        for name, subject_names in units:
            u = have.get(name.lower())
            if not u:
                u = Unit(school_id=school_id, department_id=d.id, name=name, teaching=d.kind == DepartmentKind.academic)
                db.add(u)
                db.flush()
            for sn in subject_names:
                s = subjects.get(sn.lower())
                if s and not s.unit_id:
                    s.unit_id = u.id
                    if not s.department_id:
                        s.department_id = d.id
    db.commit()
    return unit_list(db, school_id)


class SubjectUnitIn(BaseModel):
    unit_id: uuid.UUID | None


@router.put("/subjects/{subject_id}/unit", status_code=204)
def set_subject_unit(subject_id: uuid.UUID, data: SubjectUnitIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    s = db.get(Subject, subject_id)
    if not s:
        raise not_found("Subject")
    owned_school(db, user, s.school_id)
    if data.unit_id:
        u = db.get(Unit, data.unit_id)
        if not u or u.school_id != s.school_id:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Choose a unit of this school")
        s.unit_id, s.department_id = u.id, u.department_id
    else:
        s.unit_id = None
    db.commit()
    return Response(status_code=204)
