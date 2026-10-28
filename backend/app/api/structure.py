"""School structure: profile, sections, departments, houses, clubs, grading, assessment,
bell periods, calendar events, policies (school-wide), and facilities, hostels, vehicles (per branch)."""
import re
import uuid
from datetime import date, time
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.academics import LEVELS
from app.api.access import not_found, owned_branch, owned_school
from app.api.crud import add_crud, commit_or_conflict
from app.api.deps import current_user
from app.core.db import get_db
from app.models import (
    AssessmentComponent, AssessmentScheme, Bed, Club, ClubKind, Department, DepartmentKind, EventCategory, Facility,
    FacilityKind, GradeBand, GradingScale, Hostel, HostelGender, HostelRoom, House, Membership, Period, PeriodKind,
    Policy, Role, School, SchoolEvent, Section, Subject, User, Vehicle, VehicleKind,
)

router = APIRouter(prefix="/api", tags=["school structure"])

HEX = r"^#[0-9a-fA-F]{6}$"


class In(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)


class Out(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID


def bad(msg: str) -> HTTPException:
    return HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, msg)


# ======================= Profile =======================

class ProfileIn(In):
    motto: str | None = Field(default=None, max_length=200)
    logo: str | None = Field(default=None, max_length=600_000)
    address: str | None = Field(default=None, max_length=500)
    state: str | None = Field(default=None, max_length=50)
    lga: str | None = Field(default=None, max_length=100)
    phone: str | None = Field(default=None, max_length=50)
    email: str | None = Field(default=None, max_length=255)
    website: str | None = Field(default=None, max_length=255)
    founded_year: int | None = Field(default=None, ge=1800, le=2100)
    colour: str | None = None
    approval_number: str | None = Field(default=None, max_length=100)
    waec_centre_no: str | None = Field(default=None, max_length=50)
    neco_centre_no: str | None = Field(default=None, max_length=50)

    @field_validator("logo")
    @classmethod
    def check_logo(cls, v: str | None) -> str | None:
        if v and not re.match(r"^data:image/(png|jpeg|webp|svg\+xml);base64,", v):
            raise ValueError("The logo must be a PNG, JPG or WebP image")
        return v or None

    @field_validator("colour")
    @classmethod
    def check_colour(cls, v: str | None) -> str | None:
        if v and not re.match(HEX, v):
            raise ValueError("Colour must look like #0f7a4f")
        return v or None

    @field_validator("email")
    @classmethod
    def check_email(cls, v: str | None) -> str | None:
        if v and not re.match(r"^\S+@\S+\.\S+$", v):
            raise ValueError("That email address doesn't look right")
        return v.lower() if v else None


class ProfileOut(ProfileIn):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    name: str


@router.get("/schools/{school_id}/profile", response_model=ProfileOut)
def get_profile(school_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return owned_school(db, user, school_id)


@router.put("/schools/{school_id}/profile", response_model=ProfileOut)
def save_profile(school_id: uuid.UUID, data: ProfileIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    school = owned_school(db, user, school_id)
    for k, v in data.model_dump().items():
        setattr(school, k, v if v != "" else None)
    db.commit()
    db.refresh(school)
    return school


# ======================= People who can lead things =======================

class PersonOption(BaseModel):
    id: uuid.UUID
    full_name: str
    roles: list[str]


@router.get("/schools/{school_id}/staff-options", response_model=list[PersonOption])
def staff_options(school_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Owners and staff of this school, for choosing heads, patrons, house parents..."""
    school = owned_school(db, user, school_id)
    rows = db.scalars(select(Membership).where(
        Membership.group_id == school.group_id,
        Membership.role.in_([Role.owner, Role.head, Role.bursar, Role.teacher, Role.house_parent]),
        (Membership.school_id == school.id) | (Membership.role == Role.owner),
    )).all()
    people: dict[uuid.UUID, PersonOption] = {}
    for m in rows:
        p = people.setdefault(m.user_id, PersonOption(id=m.user_id, full_name=m.user.full_name, roles=[]))
        if m.role.value not in p.roles:
            p.roles.append(m.role.value)
    return sorted(people.values(), key=lambda p: p.full_name.lower())


# ======================= Grading scales =======================

class BandIn(In):
    grade: str = Field(min_length=1, max_length=10)
    min_score: int = Field(ge=0, le=100)
    max_score: int = Field(ge=0, le=100)
    remark: str = Field(default="", max_length=50)


class ScaleIn(In):
    name: str = Field(min_length=2, max_length=100)
    bands: list[BandIn] = Field(min_length=1)


class BandOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    grade: str
    min_score: int
    max_score: int
    remark: str


class ScaleOut(Out):
    name: str
    bands: list[BandOut]


GRADING_PRESETS: dict[str, list[tuple[str, int, int, str]]] = {
    "WAEC (A1 to F9)": [
        ("A1", 75, 100, "Excellent"), ("B2", 70, 74, "Very good"), ("B3", 65, 69, "Good"), ("C4", 60, 64, "Credit"),
        ("C5", 55, 59, "Credit"), ("C6", 50, 54, "Credit"), ("D7", 45, 49, "Pass"), ("E8", 40, 44, "Pass"),
        ("F9", 0, 39, "Fail"),
    ],
    "Basic (A to F)": [
        ("A", 70, 100, "Excellent"), ("B", 60, 69, "Very good"), ("C", 50, 59, "Good"), ("D", 45, 49, "Fair"),
        ("E", 40, 44, "Poor"), ("F", 0, 39, "Fail"),
    ],
}


def check_bands(bands: list[BandIn]) -> None:
    covered = [0] * 101
    grades = set()
    for b in bands:
        if b.min_score > b.max_score:
            raise bad(f"{b.grade}: the lowest score is higher than the highest")
        if b.grade.upper() in grades:
            raise bad(f"Grade {b.grade} appears twice")
        grades.add(b.grade.upper())
        for score in range(b.min_score, b.max_score + 1):
            covered[score] += 1
    overlaps = [i for i, n in enumerate(covered) if n > 1]
    gaps = [i for i, n in enumerate(covered) if n == 0]
    if overlaps:
        raise bad(f"Some grades overlap (for example a score of {overlaps[0]})")
    if gaps:
        raise bad(f"Every score from 0 to 100 needs a grade (nothing covers {gaps[0]})")


def _scales(db: Session, school_id: uuid.UUID) -> list[GradingScale]:
    return list(db.scalars(select(GradingScale).where(GradingScale.school_id == school_id).order_by(GradingScale.name)))


@router.get("/schools/{school_id}/grading-scales", response_model=list[ScaleOut])
def list_scales(school_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    owned_school(db, user, school_id)
    return _scales(db, school_id)


@router.get("/grading-presets", response_model=dict[str, list[BandOut]])
def grading_presets():
    return {k: [BandOut(grade=g, min_score=lo, max_score=hi, remark=r) for g, lo, hi, r in v] for k, v in GRADING_PRESETS.items()}


@router.post("/schools/{school_id}/grading-scales", response_model=ScaleOut, status_code=201)
def add_scale(school_id: uuid.UUID, data: ScaleIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    owned_school(db, user, school_id)
    check_bands(data.bands)
    scale = GradingScale(school_id=school_id, name=data.name, bands=[GradeBand(**b.model_dump()) for b in data.bands])
    db.add(scale)
    commit_or_conflict(db, "grading scale")
    db.refresh(scale)
    return scale


def _own_scale(db: Session, user: User, scale_id: uuid.UUID) -> GradingScale:
    scale = db.get(GradingScale, scale_id)
    if not scale:
        raise not_found("Grading scale")
    owned_school(db, user, scale.school_id)
    return scale


@router.put("/grading-scales/{scale_id}", response_model=ScaleOut)
def save_scale(scale_id: uuid.UUID, data: ScaleIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    scale = _own_scale(db, user, scale_id)
    check_bands(data.bands)
    scale.name = data.name
    scale.bands = [GradeBand(**b.model_dump()) for b in data.bands]
    commit_or_conflict(db, "grading scale")
    db.refresh(scale)
    return scale


@router.delete("/grading-scales/{scale_id}", status_code=204)
def delete_scale(scale_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    db.delete(_own_scale(db, user, scale_id))
    db.commit()
    return Response(status_code=204)


# ======================= Assessment schemes =======================

class PartIn(In):
    name: str = Field(min_length=1, max_length=50)
    max_score: int = Field(ge=1, le=100)


class ComponentIn(In):
    name: str = Field(min_length=1, max_length=50)
    max_score: int = Field(ge=1, le=100)
    parts: list[PartIn] = []


class SchemeIn(In):
    name: str = Field(min_length=2, max_length=100)
    components: list[ComponentIn] = Field(min_length=1)


class PartOut(BaseModel):
    name: str
    max_score: int


class ComponentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    name: str
    max_score: int
    parts: list[PartOut] = []


class SchemeOut(Out):
    name: str
    components: list[ComponentOut]


# Each preset is a list of (part name, marks, [(sub-part name, marks), ...]).
ASSESSMENT_PRESETS: dict[str, list[tuple[str, int, list[tuple[str, int]]]]] = {
    "CA1, CA2 and exam (20 + 20 + 60)": [("CA1", 20, []), ("CA2", 20, []), ("Exam", 60, [])],
    "CA1 in three parts, CA2 and exam (20 + 20 + 60)": [
        ("CA1", 20, [("Test", 10), ("Assignment", 5), ("Classwork", 5)]), ("CA2", 20, []), ("Exam", 60, []),
    ],
    "CA1, CA2, mid-term test and exam (10 + 10 + 20 + 60)": [
        ("CA1", 10, []), ("CA2", 10, []), ("Mid-term test", 20, []), ("Exam", 60, []),
    ],
    "CA and exam (40 + 60)": [("CA", 40, []), ("Exam", 60, [])],
    "CA and exam (30 + 70)": [("CA", 30, []), ("Exam", 70, [])],
}


def preset_components(name: str) -> list["ComponentIn"]:
    return [
        ComponentIn(name=n, max_score=m, parts=[PartIn(name=pn, max_score=pm) for pn, pm in parts])
        for n, m, parts in ASSESSMENT_PRESETS[name]
    ]


def check_components(components: list[ComponentIn]) -> None:
    names = [c.name.lower() for c in components]
    if len(set(names)) != len(names):
        raise bad("Each part needs a different name")
    total = sum(c.max_score for c in components)
    if total != 100:
        raise bad(f"The parts must add up to 100 (they add up to {total})")
    for c in components:
        if not c.parts:
            continue
        if len(c.parts) < 2:
            raise bad(f"{c.name}: split it into at least two pieces, or don't split it")
        sub = [p.name.lower() for p in c.parts]
        if len(set(sub)) != len(sub):
            raise bad(f"{c.name}: each piece needs a different name")
        sub_total = sum(p.max_score for p in c.parts)
        if sub_total != c.max_score:
            raise bad(f"{c.name}: its pieces add up to {sub_total}, but {c.name} is worth {c.max_score}")


def make_components(components: list[ComponentIn]) -> list[AssessmentComponent]:
    return [
        AssessmentComponent(name=c.name, max_score=c.max_score, position=i, parts=[p.model_dump() for p in c.parts])
        for i, c in enumerate(components)
    ]


@router.get("/assessment-presets", response_model=dict[str, list[ComponentOut]])
def assessment_presets():
    return {k: [ComponentOut(**c.model_dump()) for c in preset_components(k)] for k in ASSESSMENT_PRESETS}


@router.get("/schools/{school_id}/assessment-schemes", response_model=list[SchemeOut])
def list_schemes(school_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    owned_school(db, user, school_id)
    return list(db.scalars(select(AssessmentScheme).where(AssessmentScheme.school_id == school_id).order_by(AssessmentScheme.name)))


@router.post("/schools/{school_id}/assessment-schemes", response_model=SchemeOut, status_code=201)
def add_scheme(school_id: uuid.UUID, data: SchemeIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    owned_school(db, user, school_id)
    check_components(data.components)
    scheme = AssessmentScheme(school_id=school_id, name=data.name, components=make_components(data.components))
    db.add(scheme)
    commit_or_conflict(db, "assessment scheme")
    db.refresh(scheme)
    return scheme


def _own_scheme(db: Session, user: User, scheme_id: uuid.UUID) -> AssessmentScheme:
    scheme = db.get(AssessmentScheme, scheme_id)
    if not scheme:
        raise not_found("Assessment scheme")
    owned_school(db, user, scheme.school_id)
    return scheme


@router.put("/assessment-schemes/{scheme_id}", response_model=SchemeOut)
def save_scheme(scheme_id: uuid.UUID, data: SchemeIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    scheme = _own_scheme(db, user, scheme_id)
    check_components(data.components)
    scheme.name = data.name
    scheme.components = make_components(data.components)
    commit_or_conflict(db, "assessment scheme")
    db.refresh(scheme)
    return scheme


@router.delete("/assessment-schemes/{scheme_id}", status_code=204)
def delete_scheme(scheme_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    db.delete(_own_scheme(db, user, scheme_id))
    db.commit()
    return Response(status_code=204)


# ======================= Sections =======================

class SectionIn(In):
    name: str = Field(min_length=2, max_length=100)
    position: int = 0
    levels: list[str] = []
    head_user_id: uuid.UUID | None = None
    grading_scale_id: uuid.UUID | None = None
    assessment_scheme_id: uuid.UUID | None = None


class SectionOut(Out):
    name: str
    position: int
    levels: list[str]
    head_user_id: uuid.UUID | None
    head_name: str | None
    grading_scale_id: uuid.UUID | None
    assessment_scheme_id: uuid.UUID | None


def validate_section(db: Session, school: School, values: dict[str, Any], existing: Section | None) -> None:
    levels = values.get("levels") or []
    unknown = [lv for lv in levels if lv not in LEVELS]
    if unknown:
        raise bad(f"Unknown class level: {unknown[0]}")
    values["levels"] = sorted(set(levels), key=LEVELS.index)
    others = db.scalars(select(Section).where(Section.school_id == school.id)).all()
    for other in others:
        if existing is not None and other.id == existing.id:
            continue
        clash = set(other.levels or []) & set(levels)
        if clash:
            raise bad(f"{sorted(clash, key=LEVELS.index)[0]} is already in the {other.name} section")
    for key, model in (("grading_scale_id", GradingScale), ("assessment_scheme_id", AssessmentScheme)):
        if values.get(key):
            obj = db.get(model, values[key])
            if not obj or obj.school_id != school.id:
                raise bad("That grading scale or assessment scheme isn't in this school")


add_crud(router, model=Section, path="sections", parent="school", schema_in=SectionIn, schema_out=SectionOut,
         what="section", order_by=[Section.position, Section.name], validate=validate_section)

STANDARD_SECTIONS = [
    ("Nursery", ["Creche", "Pre-Nursery", "Nursery 1", "Nursery 2", "Nursery 3", "KG 1", "KG 2"]),
    ("Primary", ["Primary 1", "Primary 2", "Primary 3", "Primary 4", "Primary 5", "Primary 6"]),
    ("Junior Secondary", ["JSS 1", "JSS 2", "JSS 3"]),
    ("Senior Secondary", ["SS 1", "SS 2", "SS 3"]),
]


class StandardSectionsIn(BaseModel):
    names: list[str]


@router.post("/schools/{school_id}/sections/add-standard", response_model=list[SectionOut])
def add_standard_sections(school_id: uuid.UUID, data: StandardSectionsIn,
                          user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Adds any of the usual Nigerian sections that the school doesn't have yet."""
    owned_school(db, user, school_id)
    existing = db.scalars(select(Section).where(Section.school_id == school_id)).all()
    have_names = {s.name.lower() for s in existing}
    used_levels = {lv for s in existing for lv in (s.levels or [])}
    for i, (name, levels) in enumerate(STANDARD_SECTIONS):
        if name in data.names and name.lower() not in have_names:
            db.add(Section(school_id=school_id, name=name, position=i, levels=[lv for lv in levels if lv not in used_levels]))
    db.commit()
    return list(db.scalars(select(Section).where(Section.school_id == school_id).order_by(Section.position, Section.name)))


# ======================= Departments =======================

class DepartmentIn(In):
    name: str = Field(min_length=2, max_length=100)
    kind: DepartmentKind
    description: str | None = Field(default=None, max_length=500)
    head_user_id: uuid.UUID | None = None


class DepartmentOut(Out):
    name: str
    kind: DepartmentKind
    description: str | None
    head_user_id: uuid.UUID | None
    head_name: str | None


add_crud(router, model=Department, path="departments", parent="school", schema_in=DepartmentIn,
         schema_out=DepartmentOut, what="department", order_by=[Department.kind, Department.name])

STANDARD_DEPARTMENTS = {
    DepartmentKind.academic: [
        "Sciences", "Mathematics", "English and Languages", "Arts and Humanities", "Commercial", "Technical and Vocational",
        "Nursery and Primary",
    ],
    DepartmentKind.non_academic: [
        "Administration", "Bursary", "Admissions", "Boarding", "Kitchen and Catering", "Sick Bay", "Library", "ICT",
        "Guidance and Counselling", "Security", "Transport", "Maintenance and Works",
    ],
}


@router.post("/schools/{school_id}/departments/add-standard", response_model=list[DepartmentOut])
def add_standard_departments(school_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    owned_school(db, user, school_id)
    have = {d.name.lower() for d in db.scalars(select(Department).where(Department.school_id == school_id))}
    for kind, names in STANDARD_DEPARTMENTS.items():
        db.add_all(Department(school_id=school_id, name=n, kind=kind) for n in names if n.lower() not in have)
    db.commit()
    return list(db.scalars(select(Department).where(Department.school_id == school_id).order_by(Department.kind, Department.name)))


class SubjectLinkIn(BaseModel):
    department_id: uuid.UUID | None


@router.put("/subjects/{subject_id}/department", status_code=204)
def set_subject_department(subject_id: uuid.UUID, data: SubjectLinkIn,
                           user: User = Depends(current_user), db: Session = Depends(get_db)):
    subject = db.get(Subject, subject_id)
    if not subject:
        raise not_found("Subject")
    owned_school(db, user, subject.school_id)
    if data.department_id:
        d = db.get(Department, data.department_id)
        if not d or d.school_id != subject.school_id:
            raise bad("That department isn't in this school")
        if d.kind != DepartmentKind.academic:
            raise bad("Subjects can only belong to academic departments")
    subject.department_id = data.department_id
    db.commit()
    return Response(status_code=204)


# ======================= Houses and clubs =======================

class HouseIn(In):
    name: str = Field(min_length=2, max_length=100)
    colour: str | None = Field(default=None, pattern=HEX)
    motto: str | None = Field(default=None, max_length=200)
    master_user_id: uuid.UUID | None = None


class HouseOut(Out):
    name: str
    colour: str | None
    motto: str | None
    master_user_id: uuid.UUID | None
    master_name: str | None


add_crud(router, model=House, path="houses", parent="school", schema_in=HouseIn, schema_out=HouseOut,
         what="house", order_by=[House.name])


class ClubIn(In):
    name: str = Field(min_length=2, max_length=100)
    kind: ClubKind = ClubKind.club
    description: str | None = Field(default=None, max_length=500)
    meeting_time: str | None = Field(default=None, max_length=100)
    patron_user_id: uuid.UUID | None = None


class ClubOut(Out):
    name: str
    kind: ClubKind
    description: str | None
    meeting_time: str | None
    patron_user_id: uuid.UUID | None
    patron_name: str | None


add_crud(router, model=Club, path="clubs", parent="school", schema_in=ClubIn, schema_out=ClubOut,
         what="club", order_by=[Club.kind, Club.name])


# ======================= Bell periods =======================

class PeriodIn(In):
    name: str = Field(min_length=1, max_length=50)
    kind: PeriodKind
    starts_at: time
    ends_at: time
    section_id: uuid.UUID | None = None


class PeriodOut(Out):
    name: str
    kind: PeriodKind
    starts_at: time
    ends_at: time
    section_id: uuid.UUID | None
    section_name: str | None


def validate_period(db: Session, school: School, values: dict[str, Any], existing: Any) -> None:
    if values["ends_at"] <= values["starts_at"]:
        raise bad("A period must end after it starts")


add_crud(router, model=Period, path="periods", parent="school", schema_in=PeriodIn, schema_out=PeriodOut,
         what="period", order_by=[Period.starts_at], validate=validate_period)


# ======================= Calendar events =======================

class EventIn(In):
    title: str = Field(min_length=2, max_length=200)
    category: EventCategory
    starts_on: date
    ends_on: date | None = None
    branch_id: uuid.UUID | None = None
    description: str | None = Field(default=None, max_length=1000)


class EventOut(Out):
    title: str
    category: EventCategory
    starts_on: date
    ends_on: date | None
    branch_id: uuid.UUID | None
    branch_name: str | None
    description: str | None


def validate_event(db: Session, school: School, values: dict[str, Any], existing: Any) -> None:
    if values.get("ends_on") and values["ends_on"] < values["starts_on"]:
        raise bad("The event can't end before it starts")


add_crud(router, model=SchoolEvent, path="events", parent="school", schema_in=EventIn, schema_out=EventOut,
         what="event", order_by=[SchoolEvent.starts_on, SchoolEvent.title], validate=validate_event)


# ======================= Policies =======================

class PolicyIn(In):
    title: str = Field(min_length=2, max_length=200)
    category: str = Field(default="General", min_length=1, max_length=50)
    body: str = Field(default="", max_length=20_000)


class PolicyOut(Out):
    title: str
    category: str
    body: str


add_crud(router, model=Policy, path="policies", parent="school", schema_in=PolicyIn, schema_out=PolicyOut,
         what="policy", order_by=[Policy.category, Policy.title])


# ======================= Facilities (per branch) =======================

class FacilityIn(In):
    kind: FacilityKind
    name: str = Field(min_length=1, max_length=100)
    capacity: int | None = Field(default=None, ge=0, le=100_000)
    department_id: uuid.UUID | None = None
    in_charge_user_id: uuid.UUID | None = None
    notes: str | None = Field(default=None, max_length=500)


class FacilityOut(Out):
    kind: FacilityKind
    name: str
    capacity: int | None
    department_id: uuid.UUID | None
    department_name: str | None
    in_charge_user_id: uuid.UUID | None
    in_charge_name: str | None
    notes: str | None


add_crud(router, model=Facility, path="facilities", parent="branch", schema_in=FacilityIn, schema_out=FacilityOut,
         what="facility", order_by=[Facility.kind, Facility.name])


# ======================= Vehicles (per branch) =======================

class VehicleIn(In):
    name: str = Field(min_length=1, max_length=100)
    kind: VehicleKind = VehicleKind.bus
    plate_number: str | None = Field(default=None, max_length=20)
    capacity: int | None = Field(default=None, ge=1, le=200)
    driver_name: str | None = Field(default=None, max_length=100)
    driver_phone: str | None = Field(default=None, max_length=30)
    route: str | None = Field(default=None, max_length=500)

    @field_validator("plate_number")
    @classmethod
    def upper(cls, v: str | None) -> str | None:
        return v.upper() if v else v


class VehicleOut(Out):
    name: str
    kind: VehicleKind
    plate_number: str | None
    capacity: int | None
    driver_name: str | None
    driver_phone: str | None
    route: str | None


add_crud(router, model=Vehicle, path="vehicles", parent="branch", schema_in=VehicleIn, schema_out=VehicleOut,
         what="vehicle", order_by=[Vehicle.name])


# ======================= Hostels, rooms and beds (per branch) =======================

class HostelIn(In):
    name: str = Field(min_length=2, max_length=100)
    gender: HostelGender
    house_parent_user_id: uuid.UUID | None = None
    notes: str | None = Field(default=None, max_length=500)


class RoomOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    name: str


class BedOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    label: str
    room_id: uuid.UUID | None


class HostelOut(Out):
    name: str
    gender: HostelGender
    house_parent_user_id: uuid.UUID | None
    house_parent_name: str | None
    notes: str | None
    rooms: list[RoomOut]
    beds: list[BedOut]




add_crud(router, model=Hostel, path="hostels", parent="branch", schema_in=HostelIn, schema_out=HostelOut,
         what="hostel", order_by=[Hostel.name])


def _own_hostel(db: Session, user: User, hostel_id: uuid.UUID) -> Hostel:
    hostel = db.get(Hostel, hostel_id)
    if not hostel:
        raise not_found("Hostel")
    owned_branch(db, user, hostel.branch_id)
    return hostel


class RoomIn(In):
    name: str = Field(min_length=1, max_length=50)


@router.post("/hostels/{hostel_id}/rooms", response_model=HostelOut, status_code=201)
def add_room(hostel_id: uuid.UUID, data: RoomIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    hostel = _own_hostel(db, user, hostel_id)
    if any(r.name.lower() == data.name.lower() for r in hostel.rooms):
        raise HTTPException(status.HTTP_409_CONFLICT, f"{data.name} already exists in {hostel.name}")
    hostel.rooms.append(HostelRoom(name=data.name, position=len(hostel.rooms)))
    db.commit()
    db.refresh(hostel)
    return hostel


@router.patch("/hostel-rooms/{room_id}", response_model=HostelOut)
def rename_room(room_id: uuid.UUID, data: RoomIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    room = db.get(HostelRoom, room_id)
    if not room:
        raise not_found("Room")
    hostel = _own_hostel(db, user, room.hostel_id)
    if any(r.id != room.id and r.name.lower() == data.name.lower() for r in hostel.rooms):
        raise HTTPException(status.HTTP_409_CONFLICT, f"{data.name} already exists in {hostel.name}")
    room.name = data.name
    db.commit()
    db.refresh(hostel)
    return hostel


@router.delete("/hostel-rooms/{room_id}", response_model=HostelOut)
def delete_room(room_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    room = db.get(HostelRoom, room_id)
    if not room:
        raise not_found("Room")
    hostel = _own_hostel(db, user, room.hostel_id)
    hostel.beds = [b for b in hostel.beds if b.room_id != room.id]
    hostel.rooms.remove(room)
    db.commit()
    db.refresh(hostel)
    return hostel


class BedsIn(BaseModel):
    count: int = Field(ge=1, le=500)
    room_id: uuid.UUID | None = None
    bunks: bool = False  # label as Bunk 1 Top / Bunk 1 Bottom


@router.post("/hostels/{hostel_id}/beds", response_model=HostelOut, status_code=201)
def add_beds(hostel_id: uuid.UUID, data: BedsIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Adds beds, numbered after any already in that room (or in the hostel, if no room)."""
    hostel = _own_hostel(db, user, hostel_id)
    if data.room_id and not any(r.id == data.room_id for r in hostel.rooms):
        raise bad("That room isn't in this hostel")
    same_place = [b for b in hostel.beds if b.room_id == data.room_id]
    labels = {b.label for b in same_place}
    position = max((b.position for b in hostel.beds), default=-1) + 1
    n, made = 1, 0
    while made < data.count:
        new = [f"Bunk {n} top", f"Bunk {n} bottom"] if data.bunks else [f"Bed {n}"]
        if not labels & set(new):
            for label in new:
                if made < data.count:
                    hostel.beds.append(Bed(label=label, room_id=data.room_id, position=position))
                    position += 1
                    made += 1
        n += 1
    db.commit()
    db.refresh(hostel)
    return hostel


@router.delete("/beds/{bed_id}", response_model=HostelOut)
def delete_bed(bed_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    bed = db.get(Bed, bed_id)
    if not bed:
        raise not_found("Bed")
    hostel = _own_hostel(db, user, bed.hostel_id)
    hostel.beds.remove(bed)
    db.commit()
    db.refresh(hostel)
    return hostel


# ======================= Overview counts =======================

class SetupCounts(BaseModel):
    sections: int
    departments: int
    subjects: int
    houses: int
    clubs: int
    grading_scales: int
    assessment_schemes: int
    periods: int
    events: int
    policies: int
    profile_complete: bool


@router.get("/schools/{school_id}/setup-counts", response_model=SetupCounts)
def setup_counts(school_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    school = owned_school(db, user, school_id)
    from sqlalchemy import func

    def n(model) -> int:
        return db.scalar(select(func.count()).select_from(model).where(model.school_id == school_id)) or 0

    return SetupCounts(
        sections=n(Section), departments=n(Department), subjects=n(Subject), houses=n(House), clubs=n(Club),
        grading_scales=n(GradingScale), assessment_schemes=n(AssessmentScheme), periods=n(Period),
        events=n(SchoolEvent), policies=n(Policy),
        profile_complete=bool(school.motto and school.address and school.phone),
    )
