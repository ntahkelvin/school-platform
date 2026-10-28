"""Everything that makes up a school before any people are put in it.

School-wide: sections, departments, houses, clubs, grading scales, assessment schemes,
bell periods, calendar events and policies.
Per branch: facilities, hostels (with optional rooms) and beds, and vehicles.
"""
import enum
import uuid
from datetime import date, time

from sqlalchemy import JSON, Date, Enum, ForeignKey, Integer, String, Text, Time, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base
from app.models.mixins import IdMixin, TimestampMixin


def _person(column: str):
    """A link to a person (e.g. a head of department), shown by name."""
    return relationship("User", foreign_keys=column, lazy="joined")


class PersonNameMixin:
    @staticmethod
    def _name(user) -> str | None:
        return user.full_name if user else None


# ---------------- School-wide ----------------

class GradingScale(IdMixin, TimestampMixin, Base):
    __tablename__ = "grading_scales"
    __table_args__ = (UniqueConstraint("school_id", "name", name="uq_grading_scale_name"),)

    school_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("schools.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(100))
    bands: Mapped[list["GradeBand"]] = relationship(
        cascade="all, delete-orphan", order_by="GradeBand.min_score.desc()", lazy="selectin"
    )


class GradeBand(IdMixin, Base):
    __tablename__ = "grade_bands"

    scale_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("grading_scales.id", ondelete="CASCADE"), index=True)
    grade: Mapped[str] = mapped_column(String(10))
    min_score: Mapped[int] = mapped_column(Integer)
    max_score: Mapped[int] = mapped_column(Integer)
    remark: Mapped[str] = mapped_column(String(50), default="")


class AssessmentScheme(IdMixin, TimestampMixin, Base):
    __tablename__ = "assessment_schemes"
    __table_args__ = (UniqueConstraint("school_id", "name", name="uq_assessment_scheme_name"),)

    school_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("schools.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(100))
    components: Mapped[list["AssessmentComponent"]] = relationship(
        cascade="all, delete-orphan", order_by="AssessmentComponent.position", lazy="selectin"
    )


class AssessmentComponent(IdMixin, Base):
    __tablename__ = "assessment_components"

    scheme_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("assessment_schemes.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(50))  # e.g. "1st CA", "Exam"
    max_score: Mapped[int] = mapped_column(Integer)
    position: Mapped[int] = mapped_column(Integer, default=0)
    # Optional smaller pieces that make up this part, e.g. CA1 = test 10 + assignment 5 + classwork 5.
    # Each is {"name": str, "max_score": int}; together they add up to max_score.
    parts: Mapped[list[dict]] = mapped_column(JSON, default=list, server_default="[]")


class Section(IdMixin, TimestampMixin, PersonNameMixin, Base):
    """Nursery, Primary, Junior Secondary, Senior Secondary..."""

    __tablename__ = "sections"
    __table_args__ = (UniqueConstraint("school_id", "name", name="uq_section_name"),)

    school_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("schools.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(100))
    position: Mapped[int] = mapped_column(Integer, default=0)
    levels: Mapped[list[str]] = mapped_column(JSON, default=list)  # e.g. ["JSS 1", "JSS 2", "JSS 3"]
    head_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    grading_scale_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("grading_scales.id", ondelete="SET NULL"))
    assessment_scheme_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("assessment_schemes.id", ondelete="SET NULL")
    )

    head = _person("Section.head_user_id")

    @property
    def head_name(self) -> str | None:
        return self._name(self.head)


class DepartmentKind(str, enum.Enum):
    academic = "academic"
    non_academic = "non_academic"


class Department(IdMixin, TimestampMixin, PersonNameMixin, Base):
    __tablename__ = "departments"
    __table_args__ = (UniqueConstraint("school_id", "name", name="uq_department_name"),)

    school_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("schools.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(100))
    kind: Mapped[DepartmentKind] = mapped_column(Enum(DepartmentKind, name="department_kind"))
    description: Mapped[str | None] = mapped_column(String(500))
    head_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))

    head = _person("Department.head_user_id")

    @property
    def head_name(self) -> str | None:
        return self._name(self.head)


class House(IdMixin, TimestampMixin, PersonNameMixin, Base):
    """Sports / inter-house competition houses."""

    __tablename__ = "houses"
    __table_args__ = (UniqueConstraint("school_id", "name", name="uq_house_name"),)

    school_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("schools.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(100))
    colour: Mapped[str | None] = mapped_column(String(9))
    motto: Mapped[str | None] = mapped_column(String(200))
    master_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))

    master = _person("House.master_user_id")

    @property
    def master_name(self) -> str | None:
        return self._name(self.master)


class ClubKind(str, enum.Enum):
    club = "club"
    society = "society"
    sports_team = "sports_team"
    uniformed = "uniformed"  # Scouts, Boys' Brigade, Red Cross...


class Club(IdMixin, TimestampMixin, PersonNameMixin, Base):
    __tablename__ = "clubs"
    __table_args__ = (UniqueConstraint("school_id", "name", name="uq_club_name"),)

    school_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("schools.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(100))
    kind: Mapped[ClubKind] = mapped_column(Enum(ClubKind, name="club_kind"), default=ClubKind.club)
    description: Mapped[str | None] = mapped_column(String(500))
    meeting_time: Mapped[str | None] = mapped_column(String(100))  # e.g. "Wednesdays, 3pm"
    patron_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))

    patron = _person("Club.patron_user_id")

    @property
    def patron_name(self) -> str | None:
        return self._name(self.patron)


class PeriodKind(str, enum.Enum):
    lesson = "lesson"
    break_ = "break"
    assembly = "assembly"
    prep = "prep"  # evening study for boarders
    other = "other"


class Period(IdMixin, TimestampMixin, Base):
    """The school day's bell times, used later for timetables."""

    __tablename__ = "periods"

    school_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("schools.id", ondelete="CASCADE"), index=True)
    section_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("sections.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(50))
    kind: Mapped[PeriodKind] = mapped_column(Enum(PeriodKind, name="period_kind", values_callable=lambda e: [m.value for m in e]))
    starts_at: Mapped[time] = mapped_column(Time)
    ends_at: Mapped[time] = mapped_column(Time)

    section = relationship("Section", lazy="joined")

    @property
    def section_name(self) -> str | None:
        return self.section.name if self.section else None


class EventCategory(str, enum.Enum):
    resumption = "resumption"
    midterm_break = "midterm_break"
    holiday = "holiday"
    exams = "exams"
    pta_meeting = "pta_meeting"
    visiting_day = "visiting_day"
    sports = "sports"
    excursion = "excursion"
    open_day = "open_day"
    graduation = "graduation"
    religious = "religious"
    cultural = "cultural"
    other = "other"


class SchoolEvent(IdMixin, TimestampMixin, Base):
    __tablename__ = "school_events"

    school_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("schools.id", ondelete="CASCADE"), index=True)
    branch_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("branches.id", ondelete="CASCADE"))  # None = all
    title: Mapped[str] = mapped_column(String(200))
    category: Mapped[EventCategory] = mapped_column(Enum(EventCategory, name="event_category"))
    starts_on: Mapped[date] = mapped_column(Date, index=True)
    ends_on: Mapped[date | None] = mapped_column(Date)
    description: Mapped[str | None] = mapped_column(String(1000))

    branch = relationship("Branch", lazy="joined")

    @property
    def branch_name(self) -> str | None:
        return self.branch.name if self.branch else None


class Policy(IdMixin, TimestampMixin, Base):
    """School rules, uniform policy, visiting rules, what boarders should bring..."""

    __tablename__ = "policies"

    school_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("schools.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(200))
    category: Mapped[str] = mapped_column(String(50), default="General")
    body: Mapped[str] = mapped_column(Text, default="")


# ---------------- Per branch ----------------

class FacilityKind(str, enum.Enum):
    classroom = "classroom"
    laboratory = "laboratory"
    ict_lab = "ict_lab"
    library = "library"
    hall = "hall"
    sick_bay = "sick_bay"
    kitchen = "kitchen"
    dining_hall = "dining_hall"
    sports_field = "sports_field"
    staff_room = "staff_room"
    office = "office"
    chapel_mosque = "chapel_mosque"
    store = "store"
    workshop = "workshop"
    tuck_shop = "tuck_shop"
    other = "other"


class Facility(IdMixin, TimestampMixin, PersonNameMixin, Base):
    __tablename__ = "facilities"

    branch_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("branches.id", ondelete="CASCADE"), index=True)
    kind: Mapped[FacilityKind] = mapped_column(Enum(FacilityKind, name="facility_kind"))
    name: Mapped[str] = mapped_column(String(100))
    capacity: Mapped[int | None] = mapped_column(Integer)
    department_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("departments.id", ondelete="SET NULL"))
    in_charge_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    notes: Mapped[str | None] = mapped_column(String(500))

    in_charge = _person("Facility.in_charge_user_id")
    department = relationship("Department", lazy="joined")

    @property
    def in_charge_name(self) -> str | None:
        return self._name(self.in_charge)

    @property
    def department_name(self) -> str | None:
        return self.department.name if self.department else None


class HostelGender(str, enum.Enum):
    boys = "boys"
    girls = "girls"
    mixed = "mixed"


class Hostel(IdMixin, TimestampMixin, PersonNameMixin, Base):
    __tablename__ = "hostels"
    __table_args__ = (UniqueConstraint("branch_id", "name", name="uq_hostel_name"),)

    branch_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("branches.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(100))
    gender: Mapped[HostelGender] = mapped_column(Enum(HostelGender, name="hostel_gender"))
    house_parent_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    notes: Mapped[str | None] = mapped_column(String(500))

    house_parent = _person("Hostel.house_parent_user_id")
    rooms: Mapped[list["HostelRoom"]] = relationship(
        cascade="all, delete-orphan", order_by="HostelRoom.position", lazy="selectin"
    )
    beds: Mapped[list["Bed"]] = relationship(cascade="all, delete-orphan", order_by="Bed.position", lazy="selectin")

    @property
    def house_parent_name(self) -> str | None:
        return self._name(self.house_parent)


class HostelRoom(IdMixin, Base):
    __tablename__ = "hostel_rooms"
    __table_args__ = (UniqueConstraint("hostel_id", "name", name="uq_room_name"),)

    hostel_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("hostels.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(50))
    position: Mapped[int] = mapped_column(Integer, default=0)


class Bed(IdMixin, Base):
    """A bed (or bunk space). Students are given beds in the boarding module."""

    __tablename__ = "beds"

    hostel_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("hostels.id", ondelete="CASCADE"), index=True)
    room_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("hostel_rooms.id", ondelete="CASCADE"), index=True)
    label: Mapped[str] = mapped_column(String(30))
    position: Mapped[int] = mapped_column(Integer, default=0)


class VehicleKind(str, enum.Enum):
    bus = "bus"
    van = "van"
    car = "car"
    other = "other"


class Vehicle(IdMixin, TimestampMixin, Base):
    __tablename__ = "vehicles"

    branch_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("branches.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(100))  # e.g. "Bus 1"
    kind: Mapped[VehicleKind] = mapped_column(Enum(VehicleKind, name="vehicle_kind"), default=VehicleKind.bus)
    plate_number: Mapped[str | None] = mapped_column(String(20))
    capacity: Mapped[int | None] = mapped_column(Integer)
    driver_name: Mapped[str | None] = mapped_column(String(100))
    driver_phone: Mapped[str | None] = mapped_column(String(30))
    route: Mapped[str | None] = mapped_column(String(500))
