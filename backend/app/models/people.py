"""Students and their parents/guardians.

A parent is a normal User. StudentGuardian links them to each child, so one
parent login can see every child, even across branches and schools.
"""
import enum
import uuid
from datetime import date, datetime

from sqlalchemy import JSON, Boolean, Date, DateTime, Enum, ForeignKey, Integer, LargeBinary, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base
from app.models.mixins import IdMixin, TimestampMixin


class Gender(str, enum.Enum):
    male = "male"
    female = "female"


class BoardingStatus(str, enum.Enum):
    day = "day"
    boarder = "boarder"


class StudentStatus(str, enum.Enum):
    active = "active"
    graduated = "graduated"
    withdrawn = "withdrawn"


class Student(IdMixin, TimestampMixin, Base):
    __tablename__ = "students"
    __table_args__ = (UniqueConstraint("school_id", "admission_no", name="uq_student_school_admission_no"),)

    school_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("schools.id", ondelete="CASCADE"), index=True)
    branch_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("branches.id", ondelete="CASCADE"), index=True)
    class_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("classes.id", ondelete="SET NULL"), index=True)
    user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))  # student login, later

    admission_no: Mapped[str] = mapped_column(String(40))
    first_name: Mapped[str] = mapped_column(String(80))
    middle_name: Mapped[str | None] = mapped_column(String(80))
    last_name: Mapped[str] = mapped_column(String(80))
    gender: Mapped[Gender] = mapped_column(Enum(Gender, name="gender"))
    date_of_birth: Mapped[date | None] = mapped_column(Date)
    state_of_origin: Mapped[str | None] = mapped_column(String(50))
    boarding_status: Mapped[BoardingStatus] = mapped_column(
        Enum(BoardingStatus, name="boarding_status"), default=BoardingStatus.day
    )
    status: Mapped[StudentStatus] = mapped_column(Enum(StudentStatus, name="student_status"), default=StudentStatus.active)

    # The fuller profile
    photo: Mapped[str | None] = mapped_column(Text)                         # small image as a data URL
    photo_thumb: Mapped[str | None] = mapped_column(Text)                   # tiny copy for lists (about 3 KB)
    nickname: Mapped[str | None] = mapped_column(String(60))                # what they like to be called
    religion: Mapped[str | None] = mapped_column(String(30))
    nationality: Mapped[str | None] = mapped_column(String(40))
    lga: Mapped[str | None] = mapped_column(String(80))
    home_town: Mapped[str | None] = mapped_column(String(80))
    home_address: Mapped[str | None] = mapped_column(String(300))
    languages: Mapped[str | None] = mapped_column(String(120))
    nin: Mapped[str | None] = mapped_column(String(20))                     # National Identification Number, shown masked
    previous_school: Mapped[str | None] = mapped_column(String(150))
    admitted_on: Mapped[date | None] = mapped_column(Date)
    entry_class: Mapped[str | None] = mapped_column(String(40))
    house_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("houses.id", ondelete="SET NULL"), index=True)
    leadership: Mapped[str | None] = mapped_column(String(60))              # Head boy, Class captain, Library prefect...
    talents: Mapped[list] = mapped_column(JSON, default=list)               # ["Football", "Debate", "Drawing"]
    support_needs: Mapped[str | None] = mapped_column(Text)                 # learning support (private: medical right)
    left_on: Mapped[date | None] = mapped_column(Date)
    leave_reason: Mapped[str | None] = mapped_column(String(200))
    next_school: Mapped[str | None] = mapped_column(String(150))

    school_class = relationship("SchoolClass", lazy="joined")
    guardians: Mapped[list["StudentGuardian"]] = relationship(back_populates="student", cascade="all, delete-orphan")

    @property
    def full_name(self) -> str:
        return " ".join(p for p in [self.first_name, self.middle_name, self.last_name] if p)


class StudentGuardian(IdMixin, TimestampMixin, Base):
    __tablename__ = "student_guardians"
    __table_args__ = (UniqueConstraint("student_id", "user_id", name="uq_student_guardian"),)

    student_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    relationship_label: Mapped[str] = mapped_column(String(30), default="Parent")  # Father, Mother, Guardian...
    is_primary: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")   # first person to call
    emergency: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    can_pick_up: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    lives_with: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    occupation: Mapped[str | None] = mapped_column(String(100))
    address: Mapped[str | None] = mapped_column(String(300))

    student: Mapped[Student] = relationship(back_populates="guardians")
    user = relationship("User", lazy="joined")


class StudentContact(IdMixin, TimestampMixin, Base):
    """Someone else allowed to collect the student (a driver, an uncle), checked at the gate."""
    __tablename__ = "student_contacts"

    student_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(120))
    phone: Mapped[str | None] = mapped_column(String(30))
    relationship_label: Mapped[str] = mapped_column(String(40), default="Family friend")
    photo: Mapped[str | None] = mapped_column(Text)
    note: Mapped[str | None] = mapped_column(String(200))


class StudentClub(IdMixin, TimestampMixin, Base):
    __tablename__ = "student_clubs"
    __table_args__ = (UniqueConstraint("student_id", "club_id", name="uq_student_club"),)

    student_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), index=True)
    club_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("clubs.id", ondelete="CASCADE"), index=True)
    role: Mapped[str] = mapped_column(String(30), default="Member")


class ConductEntry(IdMixin, TimestampMixin, Base):
    """A merit or a demerit. Points add up for the student and for their house."""
    __tablename__ = "conduct_entries"

    school_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("schools.id", ondelete="CASCADE"), index=True)
    student_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), index=True)
    house_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("houses.id", ondelete="SET NULL"), index=True)
    kind: Mapped[str] = mapped_column(String(10))                       # merit, demerit
    category: Mapped[str] = mapped_column(String(30))
    points: Mapped[int] = mapped_column(Integer)
    note: Mapped[str | None] = mapped_column(String(300))
    by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))


class StudentAward(IdMixin, TimestampMixin, Base):
    __tablename__ = "student_awards"

    school_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("schools.id", ondelete="CASCADE"), index=True)
    student_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(150))
    level: Mapped[str] = mapped_column(String(15), default="school")    # class, school, state, national, international
    on_date: Mapped[date] = mapped_column(Date)
    note: Mapped[str | None] = mapped_column(String(300))
    by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))


class StudentNote(IdMixin, TimestampMixin, Base):
    """Pastoral notes. A private note is only for people with the safeguarding right."""
    __tablename__ = "student_notes"

    school_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("schools.id", ondelete="CASCADE"), index=True)
    student_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), index=True)
    text: Mapped[str] = mapped_column(Text)
    private: Mapped[bool] = mapped_column(Boolean, default=False)
    by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))


class StudentDocument(IdMixin, TimestampMixin, Base):
    __tablename__ = "student_documents"

    school_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("schools.id", ondelete="CASCADE"), index=True)
    student_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(30))
    filename: Mapped[str] = mapped_column(String(200))
    content_type: Mapped[str] = mapped_column(String(100))
    size: Mapped[int] = mapped_column(Integer)
    data: Mapped[bytes] = mapped_column(LargeBinary)
    uploaded_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))


class StudentEvent(IdMixin, TimestampMixin, Base):
    """Changes worth remembering: admitted, moved class, became a boarder, left."""
    __tablename__ = "student_events"

    student_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(20))
    text: Mapped[str] = mapped_column(String(300))
    by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))


class PromotionRun(IdMixin, TimestampMixin, Base):
    """End of year: every class moved up at once. Keeps where everyone was, so it can be undone."""
    __tablename__ = "promotion_runs"

    school_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("schools.id", ondelete="CASCADE"), index=True)
    label: Mapped[str] = mapped_column(String(80))
    by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    snapshot: Mapped[list] = mapped_column(JSON, default=list)      # [{student_id, class_id, status, left_on}]
    summary: Mapped[dict] = mapped_column(JSON, default=dict)
    undone: Mapped[bool] = mapped_column(Boolean, default=False)


class FamilySettings(IdMixin, TimestampMixin, Base):
    """What parents and students can do in their portal at one school."""
    __tablename__ = "family_settings"

    school_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("schools.id", ondelete="CASCADE"), unique=True)
    student_logins: Mapped[bool] = mapped_column(Boolean, default=True)
    student_from_level: Mapped[str] = mapped_column(String(20), default="JSS 1")    # younger children use their parent's login
    parents_see_sickbay: Mapped[bool] = mapped_column(Boolean, default=True)
    parents_see_conduct: Mapped[bool] = mapped_column(Boolean, default=True)
    welcome: Mapped[str | None] = mapped_column(String(600))


class FamilyNote(IdMixin, TimestampMixin, Base):
    """A parent telling the school something: my child is away or sick, someone else is collecting them."""
    __tablename__ = "family_notes"

    school_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("schools.id", ondelete="CASCADE"), index=True)
    student_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), index=True)
    by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    kind: Mapped[str] = mapped_column(String(15))                 # away, sick, collect, other
    from_date: Mapped[date] = mapped_column(Date)
    to_date: Mapped[date | None] = mapped_column(Date)
    text: Mapped[str] = mapped_column(String(600))
    collector: Mapped[str | None] = mapped_column(String(120))     # who is collecting, for "collect"
    collector_phone: Mapped[str | None] = mapped_column(String(32))
    seen_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    reply: Mapped[str | None] = mapped_column(String(400))


class AdmissionSettings(IdMixin, TimestampMixin, Base):
    """How a school takes in new students: the public form, the entrance test and offers."""
    __tablename__ = "admission_settings"

    school_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("schools.id", ondelete="CASCADE"), unique=True)
    is_open: Mapped[bool] = mapped_column(Boolean, default=True)
    code: Mapped[str] = mapped_column(String(40), unique=True)                # the secret part of the public form's address
    session_label: Mapped[str | None] = mapped_column(String(30))            # "2027/2028"
    levels: Mapped[list] = mapped_column(JSON, default=list)                  # levels taking new students, e.g. ["JSS 1", "SS 1"]
    intro: Mapped[str | None] = mapped_column(String(1000))
    form_fee: Mapped[int | None] = mapped_column(Integer)                     # naira, for information (paid at the school)
    test_on: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    test_venue: Mapped[str | None] = mapped_column(String(150))
    test_subjects: Mapped[list] = mapped_column(JSON, default=list)           # ["English", "Mathematics", "General paper"]
    pass_mark: Mapped[int | None] = mapped_column(Integer)                    # percent
    offer_days: Mapped[int] = mapped_column(Integer, default=14)              # days a family has to accept


class Application(IdMixin, TimestampMixin, Base):
    """A child applying to join the school, from form to enrolment."""
    __tablename__ = "applications"
    __table_args__ = (UniqueConstraint("school_id", "number", name="uq_application_number"),)

    school_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("schools.id", ondelete="CASCADE"), index=True)
    number: Mapped[str] = mapped_column(String(30))
    track_code: Mapped[str] = mapped_column(String(12))                       # the family uses this to check progress
    status: Mapped[str] = mapped_column(String(15), default="new", index=True)
    source: Mapped[str] = mapped_column(String(10), default="online")         # online, office
    first_name: Mapped[str] = mapped_column(String(80))
    middle_name: Mapped[str | None] = mapped_column(String(80))
    last_name: Mapped[str] = mapped_column(String(80))
    gender: Mapped[str] = mapped_column(String(10))
    date_of_birth: Mapped[date | None] = mapped_column(Date)
    level: Mapped[str] = mapped_column(String(20))
    boarding: Mapped[bool] = mapped_column(Boolean, default=False)
    previous_school: Mapped[str | None] = mapped_column(String(150))
    last_class: Mapped[str | None] = mapped_column(String(40))
    state_of_origin: Mapped[str | None] = mapped_column(String(50))
    lga: Mapped[str | None] = mapped_column(String(80))
    religion: Mapped[str | None] = mapped_column(String(30))
    photo: Mapped[str | None] = mapped_column(Text)
    allergies: Mapped[str | None] = mapped_column(String(300))
    conditions: Mapped[str | None] = mapped_column(String(300))
    support_needs: Mapped[str | None] = mapped_column(String(600))
    parent_name: Mapped[str] = mapped_column(String(150))
    parent_relationship: Mapped[str] = mapped_column(String(30), default="Parent")
    parent_phone: Mapped[str] = mapped_column(String(32))
    parent_email: Mapped[str | None] = mapped_column(String(255))
    parent_occupation: Mapped[str | None] = mapped_column(String(100))
    home_address: Mapped[str | None] = mapped_column(String(300))
    parent2_name: Mapped[str | None] = mapped_column(String(150))
    parent2_relationship: Mapped[str | None] = mapped_column(String(30))
    parent2_phone: Mapped[str | None] = mapped_column(String(32))
    sibling_note: Mapped[str | None] = mapped_column(String(200))             # brothers or sisters already here
    heard_from: Mapped[str | None] = mapped_column(String(60))
    scores: Mapped[dict] = mapped_column(JSON, default=dict)                   # {"English": 72, "Mathematics": 65}
    score_total: Mapped[int | None] = mapped_column(Integer)                  # percent
    interview: Mapped[str | None] = mapped_column(String(1000))
    staff_note: Mapped[str | None] = mapped_column(String(1000))
    offer_class_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("classes.id", ondelete="SET NULL"))
    offer_expires: Mapped[date | None] = mapped_column(Date)
    offer_note: Mapped[str | None] = mapped_column(String(600))
    student_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("students.id", ondelete="SET NULL"))
    history: Mapped[list] = mapped_column(JSON, default=list)                  # [{at, text, by}]


class ApplicationDoc(IdMixin, TimestampMixin, Base):
    __tablename__ = "application_docs"

    application_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("applications.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(30))
    filename: Mapped[str] = mapped_column(String(200))
    content_type: Mapped[str] = mapped_column(String(100))
    size: Mapped[int] = mapped_column(Integer)
    data: Mapped[bytes] = mapped_column(LargeBinary)
