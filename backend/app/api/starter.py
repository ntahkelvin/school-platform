"""The "starter set-up": fills a school with sensible Nigerian defaults in one go,
so the school only has to correct and add rather than type everything.

It never changes or removes anything the school already has. Run it twice and
nothing is duplicated.
"""
import uuid
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.academics import COMMON_SUBJECTS, TERM_NAMES
from app.api.access import owned_school
from app.api.deps import current_user
from app.api.structure import (
    ASSESSMENT_PRESETS, GRADING_PRESETS, WEIGHTED_PRESETS, preset_method, STANDARD_DEPARTMENTS, STANDARD_SECTIONS, make_components, preset_components,
)
from app.core.db import get_db
from app.models import (
    AcademicSession, AssessmentScheme, Department, DepartmentKind, EventCategory, Facility, FacilityKind, GradeBand,
    GradingScale, Hostel, HostelGender, SchoolEvent, Section, Subject, Term, User,
)

router = APIRouter(prefix="/api", tags=["starter set-up"])

PRIMARY_SUBJECTS = ["Quantitative Reasoning", "Verbal Reasoning", "Phonics", "Handwriting"]

# Which department each common subject goes into. Anything not listed is left without one.
SUBJECT_DEPARTMENT = {
    "Sciences": ["Basic Science", "Physics", "Chemistry", "Biology", "Agricultural Science", "Computer Studies",
                 "Physical and Health Education"],
    "Mathematics": ["Mathematics", "Further Mathematics"],
    "English and Languages": ["English Language", "Literature in English", "French", "Igbo", "Yoruba", "Hausa"],
    "Arts and Humanities": ["Social Studies", "Civic Education", "Christian Religious Studies",
                            "Islamic Religious Studies", "Government", "Geography", "Cultural and Creative Arts"],
    "Commercial": ["Business Studies", "Economics", "Financial Accounting", "Commerce"],
    "Technical and Vocational": ["Basic Technology", "Technical Drawing", "Home Economics"],
    "Nursery and Primary": PRIMARY_SUBJECTS,
}

SECONDARY_ONLY = {"Physics", "Chemistry", "Biology", "Further Mathematics", "Economics", "Government",
                  "Literature in English", "Geography", "Financial Accounting", "Commerce", "Technical Drawing"}

# The usual Nigerian school year. Schools change these to their own dates.
DEFAULT_TERMS = {
    1: (date(2026, 9, 14), date(2026, 12, 18)),
    2: (date(2027, 1, 11), date(2027, 4, 9)),
    3: (date(2027, 4, 26), date(2027, 7, 23)),
}
DEFAULT_EVENTS = [
    ("First term resumes", EventCategory.resumption, date(2026, 9, 14), None),
    ("First term mid-term break", EventCategory.midterm_break, date(2026, 10, 29), date(2026, 11, 2)),
    ("First term examinations", EventCategory.exams, date(2026, 12, 7), date(2026, 12, 16)),
    ("Christmas holiday", EventCategory.holiday, date(2026, 12, 19), date(2027, 1, 10)),
    ("Second term resumes", EventCategory.resumption, date(2027, 1, 11), None),
    ("Second term mid-term break", EventCategory.midterm_break, date(2027, 2, 25), date(2027, 3, 1)),
    ("Second term examinations", EventCategory.exams, date(2027, 3, 29), date(2027, 4, 7)),
    ("Easter holiday", EventCategory.holiday, date(2027, 4, 10), date(2027, 4, 25)),
    ("Third term resumes", EventCategory.resumption, date(2027, 4, 26), None),
    ("Third term mid-term break", EventCategory.midterm_break, date(2027, 6, 3), date(2027, 6, 7)),
    ("Third term examinations", EventCategory.exams, date(2027, 7, 12), date(2027, 7, 21)),
]

SECONDARY_SECTIONS = {"Junior Secondary", "Senior Secondary"}
SECONDARY_DEPARTMENTS = {"Sciences", "Arts and Humanities", "Commercial", "Technical and Vocational"}


class StarterIn(BaseModel):
    sections: list[str] = []                 # from STANDARD_SECTIONS names
    secondary_grading: str | None = None     # GRADING_PRESETS key
    primary_grading: str | None = None       # GRADING_PRESETS key
    assessment: str | None = None            # ASSESSMENT_PRESETS key
    departments: bool = True
    subjects: bool = True
    calendar: bool = True
    facilities: bool = True
    hostels: bool = True


class StarterOut(BaseModel):
    added: list[str]


@router.get("/starter-options")
def starter_options() -> dict:
    return {
        "sections": [name for name, _ in STANDARD_SECTIONS],
        "grading": list(GRADING_PRESETS),
        "assessment": [*ASSESSMENT_PRESETS, *WEIGHTED_PRESETS],
    }


def _get_or_make_scale(db: Session, school_id: uuid.UUID, preset: str, added: list[str]) -> GradingScale:
    name = preset.split(" (")[0]
    scale = db.scalar(select(GradingScale).where(GradingScale.school_id == school_id, GradingScale.name == name))
    if scale:
        return scale
    scale = GradingScale(school_id=school_id, name=name, bands=[
        GradeBand(grade=g, min_score=lo, max_score=hi, remark=r) for g, lo, hi, r in GRADING_PRESETS[preset]])
    db.add(scale)
    db.flush()
    added.append(f"Grading scale: {name}")
    return scale


@router.post("/schools/{school_id}/starter", response_model=StarterOut)
def apply_starter(school_id: uuid.UUID, data: StarterIn, user: User = Depends(current_user),
                  db: Session = Depends(get_db)) -> StarterOut:
    school = owned_school(db, user, school_id)
    standard = dict(STANDARD_SECTIONS)
    unknown = [s for s in data.sections if s not in standard]
    if unknown:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Unknown section: {unknown[0]}")
    for key, presets in ((data.secondary_grading, GRADING_PRESETS), (data.primary_grading, GRADING_PRESETS),
                         (data.assessment, {**ASSESSMENT_PRESETS, **WEIGHTED_PRESETS})):
        if key and key not in presets:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Unknown choice: {key}")

    added: list[str] = []

    # ---- Grading and CA / exam split ----
    secondary_scale = _get_or_make_scale(db, school.id, data.secondary_grading, added) if data.secondary_grading else None
    primary_scale = _get_or_make_scale(db, school.id, data.primary_grading, added) if data.primary_grading else None
    scheme = None
    if data.assessment:
        scheme_name = "Standard"
        scheme = db.scalar(select(AssessmentScheme).where(AssessmentScheme.school_id == school.id,
                                                          AssessmentScheme.name == scheme_name))
        if not scheme:
            scheme = AssessmentScheme(school_id=school.id, name=scheme_name, method=preset_method(data.assessment),
                                      components=make_components(preset_components(data.assessment)))
            db.add(scheme)
            db.flush()
            added.append(f"CA / exam split: {data.assessment}")

    # ---- Sections ----
    existing_sections = list(db.scalars(select(Section).where(Section.school_id == school.id)))
    used_levels = {lv for s in existing_sections for lv in (s.levels or [])}
    have = {s.name.lower(): s for s in existing_sections}
    for position, (name, levels) in enumerate(STANDARD_SECTIONS):
        if name not in data.sections:
            continue
        section = have.get(name.lower())
        if not section:
            section = Section(school_id=school.id, name=name, position=position,
                              levels=[lv for lv in levels if lv not in used_levels])
            db.add(section)
            used_levels |= set(section.levels)
            added.append(f"Section: {name}")
        # Only fill in grading/CA where the section doesn't have them yet.
        scale = secondary_scale if name in SECONDARY_SECTIONS else primary_scale
        if scale and not section.grading_scale_id:
            section.grading_scale_id = scale.id
        if scheme and not section.assessment_scheme_id:
            section.assessment_scheme_id = scheme.id
    db.flush()

    has_primary = any(n in data.sections for n in ("Nursery", "Primary"))
    has_secondary = any(n in SECONDARY_SECTIONS for n in data.sections)

    # ---- Departments ----
    depts = {d.name.lower(): d for d in db.scalars(select(Department).where(Department.school_id == school.id))}
    if data.departments:
        for kind, names in STANDARD_DEPARTMENTS.items():
            for n in names:
                if n == "Nursery and Primary" and not has_primary:
                    continue
                if n in SECONDARY_DEPARTMENTS and not has_secondary:
                    continue
                if n == "Boarding" and not any(b.has_boarding for b in school.branches):
                    continue
                if n.lower() not in depts:
                    d = Department(school_id=school.id, name=n, kind=kind)
                    db.add(d)
                    depts[n.lower()] = d
                    added.append(f"Department: {n}")
        db.flush()

    # ---- Subjects ----
    if data.subjects:
        subjects = {s.name.lower(): s for s in db.scalars(select(Subject).where(Subject.school_id == school.id))}
        wanted = [n for n in COMMON_SUBJECTS if has_secondary or n not in SECONDARY_ONLY]
        if has_primary:
            wanted += PRIMARY_SUBJECTS
        dept_of = {subj: dept for dept, subs in SUBJECT_DEPARTMENT.items() for subj in subs}
        new = 0
        for n in wanted:
            subj = subjects.get(n.lower())
            if not subj:
                subj = Subject(school_id=school.id, name=n)
                db.add(subj)
                subjects[n.lower()] = subj
                new += 1
            dept = depts.get(dept_of.get(n, "").lower())
            if dept and not subj.department_id:
                db.flush()
                subj.department_id = dept.id
        if new:
            added.append(f"{new} subjects, sorted into departments")

    # ---- Session, terms and calendar ----
    if data.calendar:
        session = db.scalar(select(AcademicSession).where(AcademicSession.school_id == school.id,
                                                          AcademicSession.name == "2026/2027"))
        if not session:
            any_current = db.scalar(select(Term.id).join(AcademicSession).where(
                AcademicSession.school_id == school.id, Term.is_current.is_(True)))
            session = AcademicSession(school_id=school.id, name="2026/2027", terms=[
                Term(number=n, name=TERM_NAMES[n], starts_on=DEFAULT_TERMS[n][0], ends_on=DEFAULT_TERMS[n][1],
                     is_current=(n == 1 and not any_current))
                for n in TERM_NAMES])
            db.add(session)
            added.append("Session 2026/2027 with three terms")
        titles = {t.lower() for t in db.scalars(select(SchoolEvent.title).where(SchoolEvent.school_id == school.id))}
        new_events = [e for e in DEFAULT_EVENTS if e[0].lower() not in titles]
        for title, cat, start, end in new_events:
            db.add(SchoolEvent(school_id=school.id, title=title, category=cat, starts_on=start, ends_on=end))
        if new_events:
            added.append(f"{len(new_events)} calendar dates (resumption, mid-terms, exams, holidays)")

    # ---- Facilities per branch ----
    if data.facilities:
        lab_dept = depts.get("sciences")
        for branch in school.branches:
            have_fac = {f.name.lower() for f in db.scalars(select(Facility).where(Facility.branch_id == branch.id))}
            wanted_fac: list[tuple[FacilityKind, str, Department | None]] = [
                (FacilityKind.office, "Administrative office", depts.get("administration")),
                (FacilityKind.office, "Bursary", depts.get("bursary")),
                (FacilityKind.staff_room, "Staff room", None),
                (FacilityKind.library, "Library", depts.get("library")),
                (FacilityKind.ict_lab, "ICT lab", depts.get("ict")),
                (FacilityKind.sick_bay, "Sick bay", depts.get("sick bay")),
                (FacilityKind.sports_field, "Sports field", None),
                (FacilityKind.hall, "Assembly hall", None),
            ]
            if has_secondary:
                wanted_fac += [
                    (FacilityKind.laboratory, "Physics laboratory", lab_dept),
                    (FacilityKind.laboratory, "Chemistry laboratory", lab_dept),
                    (FacilityKind.laboratory, "Biology laboratory", lab_dept),
                ]
            if branch.has_boarding:
                wanted_fac += [
                    (FacilityKind.kitchen, "Kitchen", depts.get("kitchen and catering")),
                    (FacilityKind.dining_hall, "Dining hall", depts.get("kitchen and catering")),
                ]
            count = 0
            for kind, name, dept in wanted_fac:
                if name.lower() not in have_fac:
                    db.add(Facility(branch_id=branch.id, kind=kind, name=name, department_id=dept.id if dept else None))
                    count += 1
            if count:
                added.append(f"{branch.name}: {count} facilities")

    # ---- Empty boys' and girls' hostels on boarding branches ----
    if data.hostels:
        for branch in school.branches:
            if not branch.has_boarding:
                continue
            if db.scalar(select(Hostel.id).where(Hostel.branch_id == branch.id)):
                continue  # this branch already has hostels set up its own way
            db.add_all([
                Hostel(branch_id=branch.id, name="Boys' hostel", gender=HostelGender.boys),
                Hostel(branch_id=branch.id, name="Girls' hostel", gender=HostelGender.girls),
            ])
            added.append(f"{branch.name}: boys' and girls' hostels (add rooms and beds)")

    db.commit()
    return StarterOut(added=added)
