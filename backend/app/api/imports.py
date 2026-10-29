"""Bulk upload: fill in a spreadsheet (Excel or CSV), check it, then bring it in.

Each kind of upload describes its columns once. That description is used to
make the template (with drop-down lists), to read the file and to explain errors.
Uploads are checked first ("dry run"): every row is tried inside a savepoint and
everything is rolled back. Bringing the data in runs the same code and commits.
"""
import csv
import io
import os
import re
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Callable

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from fastapi.responses import Response
from openpyxl import Workbook, load_workbook
from openpyxl.comments import Comment
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.access import owned_branch
from app.api.academics import LEVELS, _level_order
from app.api.boards import POSITIONS, _order as position_order
from app.api.deps import current_user
from app.api.people import deferred_hashes, find_or_create_user
from app.api.staff import ProfileIn, add_staff_role, save_profile
from app.api.structure import make_beds, put_in_bed
from app.api.students import GuardianIn, _check_admission_no, _link_guardian, _next_admission_no
from app.core.db import get_db
from app.core.phone import normalize_phone
from app.core.security import hash_password
from app.models import (
    Bed, Board, BoardMember, BoardingStatus, Branch, Club, ClubKind, Department, DepartmentKind, EmploymentType,
    EventCategory, Facility, FacilityKind, Gender, Hostel, HostelGender, HostelRoom, House, Membership, Role, School,
    SchoolClass, SchoolEvent, Student, Subject, User, Vehicle, VehicleKind,
)

router = APIRouter(prefix="/api", tags=["bulk upload"])

MAX_ROWS = 5000


class RowProblem(Exception):
    """A row can't be brought in; the message is shown next to the row."""


# ---------------- Reading values ----------------

def norm(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", str(text).lower()).replace("optional", "").strip()


def text(v) -> str:
    if v is None:
        return ""
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    if isinstance(v, datetime):
        return v.strftime("%Y-%m-%d")
    if isinstance(v, date):
        return v.isoformat()
    return re.sub(r"\s+", " ", str(v)).strip()


def phone_of(v) -> str | None:
    t = text(v)
    if not t:
        return None
    digits = re.sub(r"\D", "", t)
    if len(digits) == 10 and digits[0] in "789" and not t.startswith("+"):
        t = "0" + digits  # Excel drops the leading 0 of 0803...
    return t


def date_of(v, what: str) -> date | None:
    if v in (None, ""):
        return None
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    t = text(v)
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%d.%m.%Y", "%d %b %Y", "%d %B %Y", "%b %d %Y", "%d/%m/%y"):
        try:
            return datetime.strptime(t.replace(",", ""), fmt).date()
        except ValueError:
            pass
    raise RowProblem(f"{what} '{t}' isn't a date. Use day/month/year, e.g. 14/09/2026.")


def yes(v) -> bool | None:
    t = norm(text(v))
    if not t:
        return None
    if t in ("yes", "y", "true", "1", "x"):
        return True
    if t in ("no", "n", "false", "0"):
        return False
    raise RowProblem(f"'{text(v)}' should be Yes or No")


def number_of(v, what: str) -> int | None:
    t = text(v)
    if not t:
        return None
    if not re.fullmatch(r"\d+", t):
        raise RowProblem(f"{what} should be a whole number, not '{t}'")
    return int(t)


def pick(v, options: dict[str, object], what: str, default=None):
    """Matches what someone typed against a list of allowed answers, ignoring case and punctuation."""
    t = norm(text(v))
    if not t:
        return default
    for label, value in options.items():
        if norm(label) == t:
            return value
    nice = ", ".join(dict.fromkeys(options))
    raise RowProblem(f"{what} '{text(v)}' isn't one of: {nice}")


GENDERS = {"Male": Gender.male, "M": Gender.male, "Boy": Gender.male, "Female": Gender.female, "F": Gender.female, "Girl": Gender.female}
BOARDING = {"Day": BoardingStatus.day, "Day student": BoardingStatus.day, "Boarder": BoardingStatus.boarder,
            "Boarding": BoardingStatus.boarder, "B": BoardingStatus.boarder, "D": BoardingStatus.day}
DEPT_KINDS = {"Academic": DepartmentKind.academic, "Non-academic": DepartmentKind.non_academic,
              "Non academic": DepartmentKind.non_academic, "Support": DepartmentKind.non_academic}
FACILITY_LABELS = {
    "Classroom": FacilityKind.classroom, "Laboratory": FacilityKind.laboratory, "Lab": FacilityKind.laboratory,
    "ICT / computer lab": FacilityKind.ict_lab, "ICT lab": FacilityKind.ict_lab, "Computer lab": FacilityKind.ict_lab,
    "Library": FacilityKind.library, "Hall": FacilityKind.hall, "Sick bay / clinic": FacilityKind.sick_bay,
    "Sick bay": FacilityKind.sick_bay, "Clinic": FacilityKind.sick_bay, "Kitchen": FacilityKind.kitchen,
    "Dining hall": FacilityKind.dining_hall, "Sports field / court": FacilityKind.sports_field,
    "Sports field": FacilityKind.sports_field, "Staff room": FacilityKind.staff_room, "Office": FacilityKind.office,
    "Chapel / mosque": FacilityKind.chapel_mosque, "Chapel": FacilityKind.chapel_mosque, "Mosque": FacilityKind.chapel_mosque,
    "Store": FacilityKind.store, "Workshop": FacilityKind.workshop, "Tuck shop": FacilityKind.tuck_shop,
    "Other": FacilityKind.other,
}
HOSTEL_FOR = {"Boys": HostelGender.boys, "Girls": HostelGender.girls, "Mixed": HostelGender.mixed}
CLUB_KINDS = {"Club": ClubKind.club, "Society": ClubKind.society, "Sports team": ClubKind.sports_team,
              "Uniformed group": ClubKind.uniformed}
EVENT_KINDS = {
    "Resumption": EventCategory.resumption, "Mid-term break": EventCategory.midterm_break, "Holiday": EventCategory.holiday,
    "Exams": EventCategory.exams, "PTA meeting": EventCategory.pta_meeting, "Visiting day": EventCategory.visiting_day,
    "Sports / inter-house": EventCategory.sports, "Sports": EventCategory.sports, "Excursion": EventCategory.excursion,
    "Open day": EventCategory.open_day, "Graduation / prize giving": EventCategory.graduation,
    "Graduation": EventCategory.graduation, "Religious": EventCategory.religious, "Cultural day": EventCategory.cultural,
    "Other": EventCategory.other,
}
VEHICLE_KINDS = {"Bus": VehicleKind.bus, "Van": VehicleKind.van, "Car": VehicleKind.car, "Other": VehicleKind.other}
EMPLOYMENT = {"Full time": EmploymentType.full_time, "Part time": EmploymentType.part_time,
              "Contract": EmploymentType.contract, "NYSC corps member": EmploymentType.nysc, "NYSC": EmploymentType.nysc,
              "Corps member": EmploymentType.nysc, "Volunteer": EmploymentType.volunteer}
ACCESS = {"Head / principal": Role.head, "Principal": Role.head, "Head": Role.head, "Bursar": Role.bursar,
          "Teacher": Role.teacher, "House parent": Role.house_parent, "Support staff": Role.support, "None": Role.support}
COLOURS = {
    "red": "#d32f2f", "blue": "#1e63d6", "green": "#1f9d55", "yellow": "#f2c200", "gold": "#d4a017", "purple": "#7b3fbf",
    "violet": "#7c3aed", "orange": "#ef7d1a", "pink": "#e04f9a", "maroon": "#800020", "brown": "#7b4a26",
    "white": "#f4f4f4", "black": "#222222", "grey": "#7a7a7a", "gray": "#7a7a7a", "sky blue": "#3ba7e5",
    "navy": "#1b2a6b", "navy blue": "#1b2a6b", "wine": "#722f37", "lemon": "#c8d93b", "ash": "#9e9e9e",
}


# ---------------- The kinds of upload ----------------

@dataclass
class Col:
    header: str
    key: str
    required: bool = False
    hint: str = ""
    choices: list[str] | Callable[["Ctx"], list[str]] | None = None
    aliases: tuple[str, ...] = ()
    width: int = 18


@dataclass
class Ctx:
    db: Session
    branch: Branch
    school: School
    logins: list[dict] = field(default_factory=list)
    new_logins: int = 0

    def login(self, person: User, password: str | None, what: str) -> None:
        if password:
            self.new_logins += 1
            self.logins.append({"name": person.full_name, "username": person.phone or person.email,
                                "password": password, "for": what})


@dataclass
class Kind:
    key: str
    title: str          # "Staff"
    noun: str           # "staff member"
    about: str
    icon: str
    hue: str
    columns: list[Col]
    handler: Callable[[Ctx, dict], tuple[str, str]]
    examples: list[list[str]] = field(default_factory=list)


def class_names(ctx: Ctx) -> list[str]:
    return [c.name for c in ctx.db.scalars(select(SchoolClass).where(SchoolClass.branch_id == ctx.branch.id)
                                           .order_by(SchoolClass.level_order, SchoolClass.arm))]


def department_names(ctx: Ctx) -> list[str]:
    return list(ctx.db.scalars(select(Department.name).where(Department.school_id == ctx.school.id).order_by(Department.name)))


def hostel_names(ctx: Ctx) -> list[str]:
    return list(ctx.db.scalars(select(Hostel.name).where(Hostel.branch_id == ctx.branch.id).order_by(Hostel.name)))


def find_department(ctx: Ctx, name: str, create: bool = False) -> tuple[Department | None, bool]:
    if not name:
        return None, False
    d = ctx.db.scalar(select(Department).where(Department.school_id == ctx.school.id,
                                               func.lower(Department.name) == name.lower()))
    if d or not create:
        if not d:
            raise RowProblem(f"There's no department called '{name}'. Add it on the Departments page first.")
        return d, False
    d = Department(school_id=ctx.school.id, name=name, kind=DepartmentKind.academic)
    ctx.db.add(d)
    ctx.db.flush()
    return d, True


def parse_class(raw: str) -> tuple[str, str]:
    """'JSS 1A', 'jss1 a', 'SSS 2 Gold', 'Primary 4B' -> (level, arm)."""
    t = re.sub(r"\s+", " ", raw.strip())
    t = re.sub(r"^sss\b|^sss(?=\d)", "SS", t, flags=re.I)
    t = re.sub(r"^js\b|^js(?=\d)", "JSS", t, flags=re.I)
    t = re.sub(r"^pry\.?\s*", "Primary ", t, flags=re.I)
    squashed = t.replace(" ", "").lower()
    for level in sorted(LEVELS, key=len, reverse=True):
        key = level.replace(" ", "").lower()
        if squashed.startswith(key):
            rest = t
            # remove the level from the original text, however it was spaced
            letters = 0
            for i, ch in enumerate(t):
                if ch != " ":
                    letters += 1
                if letters == len(key):
                    rest = t[i + 1:]
                    break
            arm = rest.strip(" -/")
            arm = arm.upper() if len(arm) <= 2 else arm
            return level, arm
    raise RowProblem(f"'{raw}' isn't a class we know. Write it like JSS 1A, SS 2B or Primary 4.")


def find_class(ctx: Ctx, raw: str, create: bool) -> tuple[SchoolClass | None, bool]:
    if not raw:
        return None, False
    level, arm = parse_class(raw)
    c = ctx.db.scalar(select(SchoolClass).where(SchoolClass.branch_id == ctx.branch.id,
                                                SchoolClass.level == level, SchoolClass.arm == arm))
    if c:
        return c, False
    if not create:
        raise RowProblem(f"There's no class {level}{arm} yet")
    c = SchoolClass(branch_id=ctx.branch.id, level=level, arm=arm, level_order=_level_order(level))
    ctx.db.add(c)
    ctx.db.flush()
    return c, True


def find_student(ctx: Ctx, admission_no: str) -> Student:
    s = ctx.db.scalar(select(Student).where(Student.school_id == ctx.school.id,
                                            func.lower(Student.admission_no) == admission_no.lower()))
    if not s:
        raise RowProblem(f"No student with admission number {admission_no}")
    return s


def need(r: dict, key: str, what: str) -> str:
    v = text(r.get(key))
    if not v:
        raise RowProblem(f"{what} is missing")
    return v


# ---- Departments ----
def do_department(ctx: Ctx, r: dict) -> tuple[str, str]:
    name = need(r, "name", "Department name")
    kind = pick(r.get("kind"), DEPT_KINDS, "Type", DepartmentKind.academic)
    d = ctx.db.scalar(select(Department).where(Department.school_id == ctx.school.id, func.lower(Department.name) == name.lower()))
    result = "updated" if d else "added"
    if not d:
        d = Department(school_id=ctx.school.id, name=name, kind=kind)
        ctx.db.add(d)
    elif text(r.get("kind")):
        d.kind = kind
    if text(r.get("description")):
        d.description = text(r.get("description"))[:500]
    return result, f"{name} ({'academic' if d.kind == DepartmentKind.academic else 'non-academic'})"


# ---- Subjects ----
def do_subject(ctx: Ctx, r: dict) -> tuple[str, str]:
    name = need(r, "name", "Subject")
    dept, made = find_department(ctx, text(r.get("department")), create=True)
    s = ctx.db.scalar(select(Subject).where(Subject.school_id == ctx.school.id, func.lower(Subject.name) == name.lower()))
    result = "updated" if s else "added"
    if not s:
        s = Subject(school_id=ctx.school.id, name=name)
        ctx.db.add(s)
    if text(r.get("code")):
        s.code = text(r.get("code"))[:20]
    if dept:
        s.department_id = dept.id
    note = f" in {dept.name}" + (" (new department)" if made else "") if dept else ""
    return result, name + note


# ---- Classes ----
def do_class(ctx: Ctx, r: dict) -> tuple[str, str]:
    c, made = find_class(ctx, need(r, "name", "Class"), create=True)
    return ("added" if made else "skipped"), (c.name if made else f"{c.name} is already there")


# ---- Staff ----
NON_TEACHING = re.compile(r"bursar|account|cook|driver|security|cleaner|gardener|nurse|matron|secretary|admin|store|"
                          r"electric|plumb|carpenter|librarian|technician|registrar|ict officer|porter|messenger|cashier")


def role_from_job(job: str, teaching: bool) -> Role:
    j = job.lower()
    if "vice" not in j and "deputy" not in j and re.search(r"principal|head ?teacher|head ?master|head ?mistress|rector", j):
        return Role.head
    if re.search(r"bursar|accountant|cashier", j):
        return Role.bursar
    if re.search(r"boarding|house ?master|house ?mistress|matron|house ?parent|hostel", j):
        return Role.house_parent
    return Role.teacher if teaching else Role.support


def do_staff(ctx: Ctx, r: dict) -> tuple[str, str]:
    name = need(r, "full_name", "Full name")
    phone, email = phone_of(r.get("phone")), text(r.get("email")) or None
    if not phone and not email:
        raise RowProblem("Give a phone number or email so they can log in")
    job = text(r.get("job_title"))
    teaching = yes(r.get("teaching"))
    if teaching is None:
        teaching = not NON_TEACHING.search(job.lower()) if job else True
    role = pick(r.get("access"), ACCESS, "App access", None) or role_from_job(job, teaching)
    dept, _ = find_department(ctx, text(r.get("department")))
    hod = yes(r.get("hod"))
    if hod and not dept:
        raise RowProblem("Head of department is Yes, but no department is given")
    person, password = find_or_create_user(ctx.db, name, phone, email)
    ctx.login(person, password, "Staff")
    added = add_staff_role(ctx.db, ctx.branch, person, role)
    profile = ProfileIn(
        staff_no=text(r.get("staff_no")) or None, title=text(r.get("title")) or None,
        gender=pick(r.get("gender"), GENDERS, "Gender", None), job_title=job or None,
        department_id=dept.id if dept else None, teaching=teaching,
        employment_type=pick(r.get("employment"), EMPLOYMENT, "Employment", EmploymentType.full_time),
        date_joined=date_of(r.get("date_joined"), "Date joined"), qualification=text(r.get("qualification")) or None,
    )
    given = {k for k, v in profile.model_dump().items() if v not in (None, "")} | {"teaching"}
    save_profile(ctx.db, ctx.school.id, person.id, ProfileIn(**profile.model_dump(include=given)), only_given=True)
    if hod:
        dept.head_user_id = person.id
    bits = [b for b in [job, dept.name if dept else None, "head of department" if hod else None] if b]
    who = " ".join(x for x in [text(r.get("title")), person.full_name] if x)
    return ("added" if added else "updated"), who + (f": {', '.join(bits)}" if bits else "") + (" (new login)" if password else "")


# ---- Board members ----
def do_board(ctx: Ctx, r: dict) -> tuple[str, str]:
    board_name = text(r.get("board")) or "Board of Governors"
    name = need(r, "full_name", "Full name")
    phone, email = phone_of(r.get("phone")), text(r.get("email")) or None
    if not phone and not email:
        raise RowProblem("Give a phone number or email so they can log in")
    position = pick(r.get("position"), {p: p for p in POSITIONS}, "Position", "Member")
    start, end = date_of(r.get("term_start"), "Term starts"), date_of(r.get("term_end"), "Term ends")
    if start and end and end < start:
        raise RowProblem("The term can't end before it starts")
    db = ctx.db
    board = db.scalar(select(Board).where(Board.school_id == ctx.school.id, func.lower(Board.name) == board_name.lower()))
    if not board:
        board = Board(group_id=ctx.school.group_id, school_id=ctx.school.id, name=board_name)
        db.add(board)
        db.flush()
    person, password = find_or_create_user(db, name, phone, email)
    ctx.login(person, password, "Board")
    member = next((m for m in board.members if m.user_id == person.id), None)
    result = "updated" if member else "added"
    if not member:
        member = BoardMember(user_id=person.id, position=position)
        board.members.append(member)
    member.position, member.position_order = position, position_order(position)
    member.term_start, member.term_end = start or member.term_start, end or member.term_end
    has_role = db.scalar(select(Membership.id).where(
        Membership.user_id == person.id, Membership.role == Role.board_member,
        Membership.group_id == board.group_id, Membership.school_id == ctx.school.id))
    if not has_role:
        db.add(Membership(user_id=person.id, role=Role.board_member, group_id=board.group_id, school_id=ctx.school.id))
    return result, f"{person.full_name}, {position} of the {board.name}" + (" (new login)" if password else "")


# ---- Students and parents ----
def do_student(ctx: Ctx, r: dict) -> tuple[str, str]:
    db = ctx.db
    last, first = need(r, "last_name", "Surname"), need(r, "first_name", "First name")
    gender = pick(r.get("gender"), GENDERS, "Gender")
    if gender is None:
        raise RowProblem("Gender is missing")
    number = text(r.get("admission_no"))
    if number:
        exists = db.scalar(select(Student).where(Student.school_id == ctx.school.id,
                                                 func.lower(Student.admission_no) == number.lower()))
        if exists:
            return "skipped", f"{number} is already {exists.full_name}"
    boarding = pick(r.get("boarding"), BOARDING, "Day or boarding", BoardingStatus.day)
    if boarding == BoardingStatus.boarder and not ctx.branch.has_boarding:
        raise RowProblem("This is a day school, so nobody can be a boarder")
    cls, made_class = find_class(ctx, text(r.get("class")), create=True)
    if number:
        _check_admission_no(db, ctx.school.id, number)
    else:
        number = _next_admission_no(db, ctx.school.id)
    student = Student(
        school_id=ctx.school.id, branch_id=ctx.branch.id, class_id=cls.id if cls else None, admission_no=number,
        first_name=first, middle_name=text(r.get("middle_name")) or None, last_name=last, gender=gender,
        date_of_birth=date_of(r.get("date_of_birth"), "Date of birth"),
        state_of_origin=text(r.get("state_of_origin")) or None, boarding_status=boarding,
    )
    if student.date_of_birth and student.date_of_birth > date.today():
        raise RowProblem("Date of birth is in the future")
    db.add(student)
    db.flush()
    parent_note = ""
    parent_name = text(r.get("parent_name"))
    parent_phone, parent_email = phone_of(r.get("parent_phone")), text(r.get("parent_email")) or None
    if parent_name or parent_phone or parent_email:
        if not parent_name:
            raise RowProblem("The parent's name is missing")
        if not parent_phone and not parent_email:
            raise RowProblem(f"Give a phone number or email for {parent_name}")
        before = db.scalar(select(User.id).where(User.phone == normalize_phone(parent_phone))) if parent_phone else None
        login = _link_guardian(db, student, ctx.branch, GuardianIn(
            full_name=parent_name, relationship=text(r.get("relationship")) or "Parent",
            phone=parent_phone, email=parent_email))
        if login:
            ctx.new_logins += 1
            ctx.logins.append({**login, "for": f"Parent of {first} {last}"})
        parent_note = f", parent {parent_name}" + (" (new login)" if login else " (already a parent here)" if before else "")
    cls_note = f" in {cls.name}" + (" (new class)" if made_class else "") if cls else ""
    return "added", f"{first} {last} ({number}){cls_note}{', boarder' if boarding == BoardingStatus.boarder else ''}{parent_note}"


# ---- Facilities ----
def do_facility(ctx: Ctx, r: dict) -> tuple[str, str]:
    name = need(r, "name", "Name")
    kind = pick(r.get("kind"), FACILITY_LABELS, "Type")
    if kind is None:
        raise RowProblem("Type is missing")
    dept, _ = find_department(ctx, text(r.get("department")))
    f = ctx.db.scalar(select(Facility).where(Facility.branch_id == ctx.branch.id, func.lower(Facility.name) == name.lower()))
    result = "updated" if f else "added"
    if not f:
        f = Facility(branch_id=ctx.branch.id, name=name, kind=kind)
        ctx.db.add(f)
    f.kind = kind
    cap = number_of(r.get("capacity"), "Capacity")
    if cap is not None:
        f.capacity = cap
    if dept:
        f.department_id = dept.id
    if text(r.get("notes")):
        f.notes = text(r.get("notes"))[:500]
    return result, name


# ---- Hostels, rooms and beds ----
def find_hostel(ctx: Ctx, name: str, gender_raw, create: bool) -> tuple[Hostel, bool]:
    h = ctx.db.scalar(select(Hostel).where(Hostel.branch_id == ctx.branch.id, func.lower(Hostel.name) == name.lower()))
    if h:
        return h, False
    if not create:
        raise RowProblem(f"There's no hostel called '{name}'")
    gender = pick(gender_raw, HOSTEL_FOR, "For")
    if gender is None:
        raise RowProblem(f"'{name}' is a new hostel. Say who it is for: Boys, Girls or Mixed.")
    h = Hostel(branch_id=ctx.branch.id, name=name, gender=gender)
    ctx.db.add(h)
    ctx.db.flush()
    return h, True


def do_beds(ctx: Ctx, r: dict) -> tuple[str, str]:
    if not ctx.branch.has_boarding:
        raise RowProblem("This is a day school, so it has no hostels")
    hostel, made = find_hostel(ctx, need(r, "hostel", "Hostel"), r.get("for"), create=True)
    room_name = text(r.get("room"))
    room = None
    if room_name:
        room = next((x for x in hostel.rooms if x.name.lower() == room_name.lower()), None)
        if not room:
            room = HostelRoom(name=room_name, position=len(hostel.rooms))
            hostel.rooms.append(room)
            ctx.db.flush()
    count = number_of(r.get("beds"), "Beds") or 0
    if count < 1 or count > 500:
        raise RowProblem("Beds should be a number from 1 to 500")
    make_beds(hostel, count, room.id if room else None, bool(yes(r.get("bunks"))))
    where = f"{hostel.name}" + (" (new hostel)" if made else "") + (f", {room.name}" if room else ", open hall")
    return "added", f"{count} {'bunk spaces' if yes(r.get('bunks')) else 'beds'} in {where}"


_natural = lambda s: [int(x) if x.isdigit() else x for x in re.split(r"(\d+)", s.lower())]


def bed_label(raw: str) -> str:
    t = raw.strip()
    m = re.fullmatch(r"(?:bunk\s*)?(\d+)\s*(t|top|b|bottom|u|upper|l|lower)", t, flags=re.I)
    if m:
        return f"Bunk {m.group(1)} {'top' if m.group(2).lower()[0] in 'tu' else 'bottom'}"
    m = re.fullmatch(r"(?:bed\s*)?(\d+)", t, flags=re.I)
    if m:
        return f"Bed {m.group(1)}"
    return t


def do_bed_assignment(ctx: Ctx, r: dict) -> tuple[str, str]:
    student = find_student(ctx, need(r, "admission_no", "Admission number"))
    hostel, _ = find_hostel(ctx, need(r, "hostel", "Hostel"), None, create=False)
    room_name = text(r.get("room"))
    beds = [b for b in hostel.beds]
    if room_name:
        room = next((x for x in hostel.rooms if x.name.lower() == room_name.lower()), None)
        if not room:
            raise RowProblem(f"{hostel.name} has no room called '{room_name}'")
        beds = [b for b in beds if b.room_id == room.id]
    wanted = text(r.get("bed"))
    if wanted:
        label = bed_label(wanted)
        bed = next((b for b in beds if b.label.lower() == label.lower()), None)
        if not bed:
            raise RowProblem(f"There's no {label} in {hostel.name}{', ' + room_name if room_name else ''}")
    else:
        if any(b.student_id == student.id for b in beds):
            return "skipped", f"{student.full_name} already has a bed there"
        free = sorted((b for b in beds if not b.student_id), key=lambda b: (b.position, _natural(b.label)))
        if not free:
            raise RowProblem(f"No free beds left in {hostel.name}{', ' + room_name if room_name else ''}")
        bed = free[0]
    put_in_bed(ctx.db, hostel, bed, student.id)
    ctx.db.flush()
    room = next((x.name for x in hostel.rooms if x.id == bed.room_id), "hall")
    return "added", f"{student.full_name} to {hostel.name}, {room}, {bed.label}"


# ---- Houses, clubs, events, vehicles ----
def do_house(ctx: Ctx, r: dict) -> tuple[str, str]:
    name = need(r, "name", "House name")
    colour_raw = text(r.get("colour"))
    colour = None
    if colour_raw:
        colour = colour_raw if re.fullmatch(r"#[0-9a-fA-F]{6}", colour_raw) else COLOURS.get(colour_raw.lower())
        if not colour:
            raise RowProblem(f"Colour '{colour_raw}' isn't one we know. Use a name like Red or Blue, or a code like #1e63d6.")
    h = ctx.db.scalar(select(House).where(House.school_id == ctx.school.id, func.lower(House.name) == name.lower()))
    result = "updated" if h else "added"
    if not h:
        h = House(school_id=ctx.school.id, name=name)
        ctx.db.add(h)
    if colour:
        h.colour = colour
    if text(r.get("motto")):
        h.motto = text(r.get("motto"))[:200]
    return result, name


def do_club(ctx: Ctx, r: dict) -> tuple[str, str]:
    name = need(r, "name", "Name")
    c = ctx.db.scalar(select(Club).where(Club.school_id == ctx.school.id, func.lower(Club.name) == name.lower()))
    result = "updated" if c else "added"
    if not c:
        c = Club(school_id=ctx.school.id, name=name)
        ctx.db.add(c)
    c.kind = pick(r.get("kind"), CLUB_KINDS, "Type", c.kind or ClubKind.club)
    if text(r.get("meeting_time")):
        c.meeting_time = text(r.get("meeting_time"))[:100]
    if text(r.get("description")):
        c.description = text(r.get("description"))[:500]
    return result, name


def do_event(ctx: Ctx, r: dict) -> tuple[str, str]:
    title = need(r, "title", "Title")
    starts = date_of(r.get("starts_on"), "Date")
    if not starts:
        raise RowProblem("The date is missing")
    ends = date_of(r.get("ends_on"), "End date")
    if ends and ends < starts:
        raise RowProblem("It can't end before it starts")
    if ctx.db.scalar(select(SchoolEvent.id).where(SchoolEvent.school_id == ctx.school.id,
                                                   func.lower(SchoolEvent.title) == title.lower(), SchoolEvent.starts_on == starts)):
        return "skipped", f"{title} on {starts:%d %b %Y} is already on the calendar"
    ctx.db.add(SchoolEvent(school_id=ctx.school.id, title=title, starts_on=starts, ends_on=ends,
                           category=pick(r.get("category"), EVENT_KINDS, "Type", EventCategory.other),
                           description=text(r.get("description"))[:1000] or None))
    return "added", f"{title}, {starts:%d %b %Y}"


def do_vehicle(ctx: Ctx, r: dict) -> tuple[str, str]:
    name = need(r, "name", "Name")
    v = ctx.db.scalar(select(Vehicle).where(Vehicle.branch_id == ctx.branch.id, func.lower(Vehicle.name) == name.lower()))
    result = "updated" if v else "added"
    if not v:
        v = Vehicle(branch_id=ctx.branch.id, name=name)
        ctx.db.add(v)
    v.kind = pick(r.get("kind"), VEHICLE_KINDS, "Type", v.kind or VehicleKind.bus)
    for key, n in (("plate_number", 20), ("driver_name", 100), ("route", 500)):
        if text(r.get(key)):
            setattr(v, key, text(r.get(key))[:n])
    if phone_of(r.get("driver_phone")):
        v.driver_phone = phone_of(r.get("driver_phone"))
    seats = number_of(r.get("capacity"), "Seats")
    if seats is not None:
        v.capacity = seats
    return result, name


YES_NO = ["Yes", "No"]

KINDS: dict[str, Kind] = {k.key: k for k in [
    Kind("departments", "Departments", "department", "Academic departments and support teams.", "departments", "sky", [
        Col("Department name", "name", True, "e.g. Sciences, Mathematics, Bursary", aliases=("name", "department"), width=28),
        Col("Type", "kind", hint="Academic or Non-academic. Blank means Academic.", choices=["Academic", "Non-academic"]),
        Col("Description", "description", width=40),
    ], do_department, [["Sciences", "Academic", "Biology, Chemistry, Physics and Agriculture"], ["Bursary", "Non-academic", "Fees and accounts"]]),
    Kind("subjects", "Subjects", "subject", "Subjects and the department each belongs to.", "book", "blue", [
        Col("Subject", "name", True, "e.g. Further Mathematics", aliases=("subject name", "name"), width=30),
        Col("Code", "code", hint="Optional short code, e.g. FMT", width=10),
        Col("Department", "department", hint="A new department is made if it doesn't exist yet.", choices=department_names, width=26),
    ], do_subject, [["Further Mathematics", "FMT", "Mathematics"], ["Literature in English", "LIT", "English and Languages"]]),
    Kind("classes", "Classes", "class", "Every class: level and arm.", "classes", "orange", [
        Col("Class", "name", True, "Level and arm, e.g. JSS 1A, SS 2B, Primary 4 Gold", aliases=("class name",), width=20),
    ], do_class, [["JSS 1A"], ["JSS 1B"], ["SS 3D"]]),
    Kind("staff", "Staff", "staff member", "Teaching and non-teaching staff, their positions and departments. Each gets a login.",
         "staff", "cyan", [
        Col("Title", "title", hint="Mr, Mrs, Miss, Dr, Rev Fr, Sr...", choices=["Mr", "Mrs", "Miss", "Ms", "Dr", "Rev Fr", "Fr", "Rev Sr", "Sr", "Br", "Prof", "Chief"], width=10),
        Col("Full name", "full_name", True, "First name then surname", aliases=("name", "staff name"), width=26),
        Col("Gender", "gender", choices=["Male", "Female"], width=10),
        Col("Phone", "phone", True, "Their login. 0803 123 4567 or +234...", aliases=("phone number", "mobile"), width=16),
        Col("Email", "email", hint="Optional. Can also be used to log in.", width=26),
        Col("Position / job title", "job_title", hint="e.g. Principal, Vice Principal (Academics), Chemistry Teacher, Bursar, Cook",
            aliases=("position", "job title", "job"), width=30),
        Col("Department", "department", choices=department_names, width=24),
        Col("Head of department", "hod", hint="Yes makes them the head of the department in the column before.",
            choices=YES_NO, aliases=("hod",), width=12),
        Col("Teaching staff", "teaching", hint="Yes or No. Blank: worked out from the position.", choices=YES_NO, width=12),
        Col("App access", "access", hint="Blank: worked out from the position (Principal → Head, Bursar → Bursar, Boarding master → House parent, teachers → Teacher).",
            choices=["Head / principal", "Bursar", "Teacher", "House parent", "Support staff"], width=18),
        Col("Staff number", "staff_no", aliases=("staff no", "staff id"), width=14),
        Col("Employment", "employment", choices=["Full time", "Part time", "Contract", "NYSC corps member", "Volunteer"], width=16),
        Col("Date joined", "date_joined", hint="Day/month/year, e.g. 05/09/2019", width=14),
        Col("Qualification", "qualification", hint="e.g. B.Sc. Ed, NCE, M.Sc.", width=16),
    ], do_staff, [
        ["Rev Fr", "John Okafor", "Male", "08031234567", "principal@school.ng", "Principal", "", "", "Yes", "", "JMC/001", "Full time", "01/09/2018", "M.Ed"],
        ["Mrs", "Ngozi Eze", "Female", "08051234567", "", "Chemistry Teacher", "Sciences", "Yes", "Yes", "", "JMC/014", "Full time", "12/01/2021", "B.Sc. Ed"],
        ["Mr", "Musa Bello", "Male", "07061234567", "", "Driver", "Transport", "", "No", "", "JMC/040", "Contract", "", ""],
    ]),
    Kind("board", "Board members", "board member", "Members of the school's board. Each gets a read-only login.", "users", "rose", [
        Col("Board", "board", hint="Blank means Board of Governors. A new board is made if needed.", width=22),
        Col("Full name", "full_name", True, aliases=("name",), width=26),
        Col("Phone", "phone", True, "Their login", aliases=("phone number",), width=16),
        Col("Email", "email", width=26),
        Col("Position", "position", hint="Blank means Member.", choices=POSITIONS, width=18),
        Col("Term starts", "term_start", hint="Day/month/year", width=13),
        Col("Term ends", "term_end", hint="Day/month/year", width=13),
    ], do_board, [["Board of Governors", "Chief Emeka Obi", "08033334444", "", "Chairman", "01/01/2024", "31/12/2027"]]),
    Kind("students", "Students and parents", "student", "Students with their class, day or boarding, and one parent. Parents get a login; brothers and sisters share one.",
         "students", "violet", [
        Col("Admission number", "admission_no", hint="Blank: one is given automatically.", aliases=("admission no", "adm no", "reg no"), width=18),
        Col("Surname", "last_name", True, aliases=("last name", "family name"), width=16),
        Col("First name", "first_name", True, aliases=("firstname", "given name"), width=16),
        Col("Middle name", "middle_name", aliases=("other names", "other name"), width=16),
        Col("Gender", "gender", True, choices=["Male", "Female"], aliases=("sex",), width=10),
        Col("Date of birth", "date_of_birth", hint="Day/month/year", aliases=("dob", "birthday"), width=14),
        Col("Class", "class", hint="e.g. JSS 1A. A new class is made if it doesn't exist yet.", choices=class_names, width=12),
        Col("Day or boarding", "boarding", hint="Day or Boarder. Blank means Day.", choices=["Day", "Boarder"], aliases=("boarding", "day boarding"), width=14),
        Col("State of origin", "state_of_origin", aliases=("state",), width=14),
        Col("Parent's full name", "parent_name", hint="Mother, father or guardian", aliases=("parent name", "guardian name", "parent"), width=26),
        Col("Relationship", "relationship", choices=["Father", "Mother", "Guardian", "Uncle", "Aunt", "Grandparent", "Sponsor"], width=13),
        Col("Parent's phone", "parent_phone", hint="Their login. Children with the same parent phone are linked as brothers and sisters.",
            aliases=("parent phone", "guardian phone"), width=16),
        Col("Parent's email", "parent_email", aliases=("parent email", "guardian email"), width=26),
    ], do_student, [
        ["", "Okafor", "Chidi", "Emeka", "Male", "14/03/2013", "JSS 1A", "Boarder", "Anambra", "Mr Emeka Okafor", "Father", "08021234567", ""],
        ["", "Okafor", "Ada", "", "Female", "02/11/2010", "JSS 3B", "Boarder", "Anambra", "Mr Emeka Okafor", "Father", "08021234567", ""],
    ]),
    Kind("facilities", "Facilities", "facility", "Classrooms, labs, library, halls, sick bay and more.", "facilities", "teal", [
        Col("Type", "kind", True, choices=["Classroom", "Laboratory", "ICT / computer lab", "Library", "Hall", "Sick bay / clinic",
                                           "Kitchen", "Dining hall", "Sports field / court", "Staff room", "Office", "Chapel / mosque",
                                           "Store", "Workshop", "Tuck shop", "Other"], width=20),
        Col("Name", "name", True, aliases=("facility",), width=26),
        Col("Capacity", "capacity", hint="How many people it holds", width=10),
        Col("Department", "department", choices=department_names, width=24),
        Col("Notes", "notes", width=30),
    ], do_facility, [["Laboratory", "Physics laboratory", "40", "Sciences", ""], ["Hall", "Assembly hall", "800", "", ""]]),
    Kind("beds", "Hostel rooms and beds", "row of beds", "Hostels, their rooms and how many beds each room has.", "bed", "indigo", [
        Col("Hostel", "hostel", True, hint="A new hostel is made if it doesn't exist yet.", choices=hostel_names, width=22),
        Col("For", "for", hint="Boys, Girls or Mixed. Needed for a new hostel.", choices=["Boys", "Girls", "Mixed"], width=10),
        Col("Room", "room", hint="Blank for one big open hall.", width=14),
        Col("Beds", "beds", True, "How many beds (or bunk spaces) to add", aliases=("number of beds", "bed count"), width=10),
        Col("Bunk beds", "bunks", hint="Yes: beds are numbered Bunk 1 top, Bunk 1 bottom...", choices=YES_NO, width=11),
    ], do_beds, [["St Ignatius House", "Boys", "Room 1", "16", "Yes"], ["St Mary's House", "Girls", "", "40", "No"]]),
    Kind("bed-assignments", "Beds for boarders", "boarder", "Which boarder sleeps in which bed. Leave Bed blank to use the next free one.",
         "hostel", "violet", [
        Col("Admission number", "admission_no", True, aliases=("admission no", "adm no"), width=18),
        Col("Hostel", "hostel", True, choices=hostel_names, width=22),
        Col("Room", "room", width=14),
        Col("Bed", "bed", hint="e.g. Bed 3, 3, Bunk 2 top, 2T, 2B. Blank: the next free bed.", width=14),
    ], do_bed_assignment, [["ADM/2026/0001", "St Ignatius House", "Room 1", "1T"], ["ADM/2026/0002", "St Mary's House", "", ""]]),
    Kind("houses", "Houses", "house", "Sports houses with their colours.", "houses", "rose", [
        Col("House name", "name", True, aliases=("house", "name"), width=22),
        Col("Colour", "colour", hint="A name like Red, Blue, Yellow, Green, Purple, or a code like #1e63d6", width=12),
        Col("Motto", "motto", width=30),
    ], do_house, [["Loyola House", "Red", "Strive"], ["Xavier House", "Blue", ""]]),
    Kind("clubs", "Clubs and societies", "club", "Clubs, societies, sports teams and uniformed groups.", "club", "amber", [
        Col("Name", "name", True, aliases=("club",), width=26),
        Col("Type", "kind", choices=list(CLUB_KINDS.keys()), width=16),
        Col("When it meets", "meeting_time", hint="e.g. Wednesdays, 3pm", width=20),
        Col("Description", "description", width=30),
    ], do_club, [["JETS Club", "Club", "Wednesdays, 3pm", ""], ["Boys' Brigade", "Uniformed group", "Fridays, 4pm", ""]]),
    Kind("events", "Calendar events", "event", "Resumption, mid-terms, exams, PTA meetings, visiting days and holidays.", "calendar", "pink", [
        Col("Title", "title", True, width=30),
        Col("Type", "category", choices=["Resumption", "Mid-term break", "Holiday", "Exams", "PTA meeting", "Visiting day",
                                          "Sports / inter-house", "Excursion", "Open day", "Graduation / prize giving",
                                          "Religious", "Cultural day", "Other"], width=20),
        Col("Date", "starts_on", True, "Day/month/year. The first day.", aliases=("start date", "starts", "from"), width=13),
        Col("End date", "ends_on", hint="Blank for one day", aliases=("ends", "to"), width=13),
        Col("Details", "description", width=30),
    ], do_event, [["First term resumes", "Resumption", "14/09/2026", "", "Boarders arrive from 10am"]]),
    Kind("vehicles", "Vehicles", "vehicle", "School buses and other vehicles.", "bus", "amber", [
        Col("Name", "name", True, width=16),
        Col("Type", "kind", choices=list(VEHICLE_KINDS.keys()), width=10),
        Col("Plate number", "plate_number", width=14),
        Col("Seats", "capacity", width=8),
        Col("Driver's name", "driver_name", width=20),
        Col("Driver's phone", "driver_phone", width=16),
        Col("Route", "route", width=30),
    ], do_vehicle, [["Bus 1", "Bus", "RSH 412 AB", "32", "Mr Chukwu", "08032221111", "Rumuokoro, Eliozu, Woji"]]),
]}


# ---------------- Templates ----------------

def make_template(ctx: Ctx, kind: Kind) -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.title = kind.title[:31]
    lists = wb.create_sheet("Lists")
    head_fill = PatternFill("solid", fgColor="0F766E")
    need_fill = PatternFill("solid", fgColor="B45309")
    list_col = 0
    for i, col in enumerate(kind.columns, start=1):
        cell = ws.cell(row=1, column=i, value=col.header + (" *" if col.required else ""))
        cell.font = Font(bold=True, color="FFFFFF")
        cell.fill = need_fill if col.required else head_fill
        cell.alignment = Alignment(vertical="center", wrap_text=True)
        if col.hint:
            cell.comment = Comment(col.hint, "School Platform", width=260, height=90)
        ws.column_dimensions[get_column_letter(i)].width = max(col.width, len(col.header) + 4)
        choices = col.choices(ctx) if callable(col.choices) else col.choices
        if choices:
            list_col += 1
            letter = get_column_letter(list_col)
            lists.cell(row=1, column=list_col, value=col.header)
            for j, c in enumerate(choices, start=2):
                lists.cell(row=j, column=list_col, value=c)
            # Free typing is still allowed (a new class, say); the list is a help, not a rule.
            dv = DataValidation(type="list", formula1=f"=Lists!${letter}$2:${letter}${len(choices) + 1}",
                                allow_blank=True, showErrorMessage=False)
            ws.add_data_validation(dv)
            dv.add(f"{get_column_letter(i)}2:{get_column_letter(i)}{MAX_ROWS + 1}")
    # Phone numbers and admission numbers are text, so Excel keeps the leading 0.
    for i, col in enumerate(kind.columns, start=1):
        if "phone" in col.key or col.key in ("admission_no", "staff_no", "code"):
            ws.column_dimensions[get_column_letter(i)].number_format = "@"
    ws.row_dimensions[1].height = 32
    ws.freeze_panes = "A2"
    lists.sheet_state = "hidden"

    ex = wb.create_sheet("Example")
    for i, col in enumerate(kind.columns, start=1):
        c = ex.cell(row=1, column=i, value=col.header + (" *" if col.required else ""))
        c.font = Font(bold=True)
        ex.column_dimensions[get_column_letter(i)].width = ws.column_dimensions[get_column_letter(i)].width
    for r, row in enumerate(kind.examples, start=2):
        for i, v in enumerate(row, start=1):
            ex.cell(row=r, column=i, value=v).font = Font(italic=True, color="555555")

    how = wb.create_sheet("How to fill it")
    how.column_dimensions["A"].width = 26
    how.column_dimensions["B"].width = 11
    how.column_dimensions["C"].width = 80
    how["A1"] = f"{kind.title} for {ctx.school.name}"
    how["A1"].font = Font(bold=True, size=14)
    how["A2"] = kind.about
    how["A3"] = (f"Put one {kind.noun} on each row of the '{ws.title}' sheet. Keep row 1 as it is. "
                 "Columns marked * must be filled. Grey drop-down lists help, but you can type too. "
                 "Save as Excel (.xlsx) or CSV, then upload it on the Bulk upload page. Nothing is saved until you have checked it.")
    how["A3"].alignment = Alignment(wrap_text=True, vertical="top")
    how.merge_cells("A3:C3")
    how.row_dimensions[3].height = 48
    for i, h in enumerate(["Column", "Needed?", "What to put"], start=1):
        c = how.cell(row=5, column=i, value=h)
        c.font = Font(bold=True, color="FFFFFF")
        c.fill = head_fill
    for r, col in enumerate(kind.columns, start=6):
        how.cell(row=r, column=1, value=col.header)
        how.cell(row=r, column=2, value="Yes" if col.required else "")
        how.cell(row=r, column=3, value=col.hint).alignment = Alignment(wrap_text=True)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


# ---------------- Reading an uploaded file ----------------

def read_rows(filename: str, data: bytes) -> list[list]:
    name = filename.lower()
    if name.endswith((".xlsx", ".xlsm")):
        try:
            wb = load_workbook(io.BytesIO(data), read_only=True, data_only=True)
        except Exception:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "That Excel file can't be opened. Save it again as .xlsx and retry.")
        ws = wb.worksheets[0]
        return [list(r) for r in ws.iter_rows(values_only=True)]
    if name.endswith((".csv", ".txt")):
        for enc in ("utf-8-sig", "cp1252"):
            try:
                content = data.decode(enc)
                break
            except UnicodeDecodeError:
                continue
        dialect = csv.Sniffer().sniff(content[:2000], delimiters=",;\t") if content.strip() else csv.excel
        return [row for row in csv.reader(io.StringIO(content), dialect)]
    if name.endswith(".xls"):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "That's an old Excel file (.xls). In Excel choose Save As, then Excel Workbook (.xlsx).")
    raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Upload an Excel file (.xlsx) or a CSV file")


def map_columns(kind: Kind, header: list) -> tuple[dict[int, str], list[str]]:
    lookup: dict[str, str] = {}
    for col in kind.columns:
        for alias in (col.header, col.key.replace("_", " "), *col.aliases):
            lookup.setdefault(norm(alias), col.key)
    mapping: dict[int, str] = {}
    unknown = []
    for i, h in enumerate(header):
        h = text(h)
        if not h:
            continue
        key = lookup.get(norm(h.replace("*", "")))
        if key and key not in mapping.values():
            mapping[i] = key
        else:
            unknown.append(h)
    return mapping, unknown


class RowResult(BaseModel):
    row: int
    status: str      # added, updated, skipped, error
    message: str


class ImportResult(BaseModel):
    kind: str
    committed: bool
    total: int
    added: int
    updated: int
    skipped: int
    errors: int
    new_logins: int
    unknown_columns: list[str]
    rows: list[RowResult]
    logins: list[dict]


class KindOut(BaseModel):
    key: str
    title: str
    noun: str
    about: str
    icon: str
    hue: str
    columns: list[dict]


def _ctx(db: Session, user: User, branch_id: uuid.UUID) -> Ctx:
    branch = owned_branch(db, user, branch_id)
    return Ctx(db=db, branch=branch, school=branch.school)


def _kind(key: str) -> Kind:
    if key not in KINDS:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown kind of upload")
    return KINDS[key]


@router.get("/branches/{branch_id}/imports", response_model=list[KindOut])
def list_kinds(branch_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    _ctx(db, user, branch_id)
    return [KindOut(key=k.key, title=k.title, noun=k.noun, about=k.about, icon=k.icon, hue=k.hue,
                    columns=[{"header": c.header, "required": c.required, "hint": c.hint} for c in k.columns])
            for k in KINDS.values()]


@router.get("/branches/{branch_id}/imports/{kind}/template")
def template(branch_id: uuid.UUID, kind: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    ctx = _ctx(db, user, branch_id)
    k = _kind(kind)
    body = make_template(ctx, k)
    safe = re.sub(r"[^A-Za-z0-9 ._-]+", "", f"{ctx.school.name} - {k.title}.xlsx")
    return Response(body, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    headers={"Content-Disposition": f'attachment; filename="{safe}"'})


@router.post("/branches/{branch_id}/imports/{kind}", response_model=ImportResult)
def run_import(
    branch_id: uuid.UUID, kind: str, file: UploadFile = File(...), commit: bool = Query(False),
    user: User = Depends(current_user), db: Session = Depends(get_db),
):
    ctx = _ctx(db, user, branch_id)
    k = _kind(kind)
    data = file.file.read()
    if len(data) > 10 * 1024 * 1024:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "That file is bigger than 10 MB")
    rows = read_rows(file.filename or "", data)
    # The header is the first row with something in it.
    start = next((i for i, r in enumerate(rows) if any(text(v) for v in r)), None)
    if start is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "The file is empty")
    mapping, unknown = map_columns(k, rows[start])
    missing = [c.header for c in k.columns if c.required and c.key not in mapping.values()]
    if missing:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            f"These columns are missing: {', '.join(missing)}. Download the template to see the columns.")
    body = [(start + 2 + n, r) for n, r in enumerate(rows[start + 1:]) if any(text(v) for v in r)]
    if len(body) > MAX_ROWS:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Upload at most {MAX_ROWS} rows at a time")

    results: list[RowResult] = []
    pending: list = []
    token = deferred_hashes.set(pending)
    try:
        _run_rows(db, ctx, k, mapping, body, results)
    finally:
        deferred_hashes.reset(token)
    if commit:
        # bcrypt lets go of Python's lock, so several passwords hash at once.
        with ThreadPoolExecutor(max_workers=min(8, os.cpu_count() or 2)) as pool:
            hashes = list(pool.map(hash_password, [pw for _, pw in pending]))
        for (person, _), h in zip(pending, hashes):
            if person.password_hash == "!pending":
                person.password_hash = h
        db.commit()
    else:
        db.rollback()
    count = lambda s: sum(1 for r in results if r.status == s)
    return ImportResult(
        kind=k.key, committed=commit, total=len(results), added=count("added"), updated=count("updated"),
        skipped=count("skipped"), errors=count("error"), new_logins=ctx.new_logins, unknown_columns=unknown,
        rows=results, logins=ctx.logins if commit else [],
    )


def _run_rows(db: Session, ctx: Ctx, k: Kind, mapping: dict[int, str], body: list, results: list[RowResult]) -> None:
    for line, raw in body:
        record = {key: (raw[i] if i < len(raw) else None) for i, key in mapping.items()}
        logins_before, new_before = len(ctx.logins), ctx.new_logins
        savepoint = db.begin_nested()
        problem = None
        try:
            outcome, message = k.handler(ctx, record)
            db.flush()
            savepoint.commit()
            results.append(RowResult(row=line, status=outcome, message=message))
            continue
        except RowProblem as e:
            problem = str(e)
        except HTTPException as e:
            problem = str(e.detail)
        except IntegrityError:
            problem = "This clashes with something already saved (a phone, email or name used twice)"
        except ValueError as e:
            problem = str(e).split("\n")[0]
        savepoint.rollback()
        del ctx.logins[logins_before:]
        ctx.new_logins = new_before
        results.append(RowResult(row=line, status="error", message=problem))
