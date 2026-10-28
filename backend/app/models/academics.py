"""How the school year and teaching are organised.

Session (e.g. 2026/2027) -> three Terms.  Classes belong to a branch (e.g. JSS 1A at Lekki).
Subjects are shared across all branches of a school.
"""
import uuid
from datetime import date

from sqlalchemy import Boolean, Date, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base
from app.models.mixins import IdMixin, TimestampMixin


class AcademicSession(IdMixin, TimestampMixin, Base):
    __tablename__ = "academic_sessions"
    __table_args__ = (UniqueConstraint("school_id", "name", name="uq_session_school_name"),)

    school_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("schools.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(20))  # e.g. "2026/2027"

    terms: Mapped[list["Term"]] = relationship(
        back_populates="session", cascade="all, delete-orphan", order_by="Term.number"
    )


class Term(IdMixin, TimestampMixin, Base):
    __tablename__ = "terms"
    __table_args__ = (UniqueConstraint("session_id", "number", name="uq_term_session_number"),)

    session_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("academic_sessions.id", ondelete="CASCADE"), index=True)
    number: Mapped[int] = mapped_column(Integer)  # 1, 2 or 3
    name: Mapped[str] = mapped_column(String(50))  # "First term"
    starts_on: Mapped[date | None] = mapped_column(Date)
    ends_on: Mapped[date | None] = mapped_column(Date)
    is_current: Mapped[bool] = mapped_column(Boolean, default=False)

    session: Mapped[AcademicSession] = relationship(back_populates="terms")


class SchoolClass(IdMixin, TimestampMixin, Base):
    """A class at one branch, e.g. level "JSS 1" + arm "A" = "JSS 1A"."""

    __tablename__ = "classes"
    __table_args__ = (UniqueConstraint("branch_id", "level", "arm", name="uq_class_branch_level_arm"),)

    branch_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("branches.id", ondelete="CASCADE"), index=True)
    level: Mapped[str] = mapped_column(String(30))
    level_order: Mapped[int] = mapped_column(Integer, default=0)  # used for sorting and promotion
    arm: Mapped[str] = mapped_column(String(20), default="")
    form_teacher_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))

    @property
    def name(self) -> str:
        return f"{self.level}{self.arm}" if len(self.arm) <= 2 else f"{self.level} {self.arm}"


class Subject(IdMixin, TimestampMixin, Base):
    __tablename__ = "subjects"
    __table_args__ = (UniqueConstraint("school_id", "name", name="uq_subject_school_name"),)

    school_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("schools.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(100))
    code: Mapped[str | None] = mapped_column(String(20))
    department_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("departments.id", ondelete="SET NULL"))
