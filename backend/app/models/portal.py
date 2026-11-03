"""The student's own portal: joining clubs, personal goals, books read, and reporting a worry."""
import uuid
from datetime import date, datetime

from sqlalchemy import JSON, Boolean, Date, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.models.mixins import IdMixin, TimestampMixin


class ClubRequest(IdMixin, TimestampMixin, Base):
    __tablename__ = "club_requests"

    school_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("schools.id", ondelete="CASCADE"), index=True)
    club_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("clubs.id", ondelete="CASCADE"), index=True)
    student_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), index=True)
    why: Mapped[str | None] = mapped_column(String(300))
    status: Mapped[str] = mapped_column(String(10), default="waiting")          # waiting, accepted, declined, cancelled
    decided_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    note: Mapped[str | None] = mapped_column(String(200))


class StudentGoal(IdMixin, TimestampMixin, Base):
    __tablename__ = "student_goals"

    student_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(150))
    area: Mapped[str] = mapped_column(String(15), default="study")              # study, reading, sport, character, skill, other
    target_on: Mapped[date | None] = mapped_column(Date)
    progress: Mapped[int] = mapped_column(Integer, default=0)                   # 0-100
    status: Mapped[str] = mapped_column(String(10), default="active")           # active, done, dropped
    steps: Mapped[list] = mapped_column(JSON, default=list)                     # [{text, done}]
    updates: Mapped[list] = mapped_column(JSON, default=list)                   # [{at, text, progress}]
    teacher_note: Mapped[str | None] = mapped_column(String(300))               # a word of encouragement from the form teacher


class ReadingEntry(IdMixin, TimestampMixin, Base):
    """A book a student read, from the library or from home."""
    __tablename__ = "reading_entries"
    __table_args__ = (UniqueConstraint("student_id", "loan_id", name="uq_reading_loan"),)

    student_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), index=True)
    loan_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("loans.id", ondelete="SET NULL"))
    title: Mapped[str] = mapped_column(String(250))
    author: Mapped[str | None] = mapped_column(String(200))
    rating: Mapped[int | None] = mapped_column(Integer)                         # 1-5 stars
    review: Mapped[str | None] = mapped_column(String(500))
    finished_on: Mapped[date] = mapped_column(Date)


class Concern(IdMixin, TimestampMixin, Base):
    """A student telling the school something is wrong. Only people with the safeguarding right see it."""
    __tablename__ = "concerns"

    school_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("schools.id", ondelete="CASCADE"), index=True)
    student_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(15))                               # bullying, unsafe, sad, online, health, other
    text: Mapped[str] = mapped_column(Text)
    about: Mapped[str | None] = mapped_column(String(200))                      # who or what it is about
    where: Mapped[str | None] = mapped_column(String(120))
    urgent: Mapped[bool] = mapped_column(Boolean, default=False)
    status: Mapped[str] = mapped_column(String(10), default="new", index=True)  # new, seen, acting, closed
    handled_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    reply: Mapped[str | None] = mapped_column(String(500))                      # what the student is told
    notes: Mapped[list] = mapped_column(JSON, default=list)                     # private staff notes [{at, by, text}]
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
