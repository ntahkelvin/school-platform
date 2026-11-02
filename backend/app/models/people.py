"""Students and their parents/guardians.

A parent is a normal User. StudentGuardian links them to each child, so one
parent login can see every child, even across branches and schools.
"""
import enum
import uuid
from datetime import date

from sqlalchemy import JSON, Boolean, Date, Enum, ForeignKey, Integer, LargeBinary, String, Text, UniqueConstraint
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
