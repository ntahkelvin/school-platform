"""Students and their parents/guardians.

A parent is a normal User. StudentGuardian links them to each child, so one
parent login can see every child, even across branches and schools.
"""
import enum
import uuid
from datetime import date

from sqlalchemy import Date, Enum, ForeignKey, String, UniqueConstraint
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

    student: Mapped[Student] = relationship(back_populates="guardians")
    user = relationship("User", lazy="joined")
