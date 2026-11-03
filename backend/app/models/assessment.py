"""Assessment: homework and assignments, score sheets (CA and exam), and report cards."""
import uuid
from datetime import date, datetime

from sqlalchemy import JSON, Boolean, Date, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.models.mixins import IdMixin, TimestampMixin


class Assignment(IdMixin, TimestampMixin, Base):
    """Homework, classwork, a project or a class test set by a teacher for a class (or an elective group)."""
    __tablename__ = "assignments"

    school_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("schools.id", ondelete="CASCADE"), index=True)
    class_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("classes.id", ondelete="CASCADE"), index=True)
    group_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("teaching_groups.id", ondelete="CASCADE"), index=True)
    subject_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("subjects.id", ondelete="CASCADE"), index=True)
    term_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("terms.id", ondelete="SET NULL"), index=True)
    teacher_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), index=True)
    kind: Mapped[str] = mapped_column(String(12), default="homework")          # homework, classwork, project, test
    title: Mapped[str] = mapped_column(String(150))
    instructions: Mapped[str | None] = mapped_column(Text)
    link: Mapped[str | None] = mapped_column(String(500))
    set_on: Mapped[date] = mapped_column(Date)
    due_on: Mapped[date | None] = mapped_column(Date)
    max_score: Mapped[int | None] = mapped_column(Integer)
    online: Mapped[bool] = mapped_column(Boolean, default=True)                 # students may hand it in on the portal
    counts_to: Mapped[str | None] = mapped_column(String(80))                   # "CA1" or "CA1 › Assignment" once sent to the score sheet


class Submission(IdMixin, TimestampMixin, Base):
    __tablename__ = "submissions"
    __table_args__ = (UniqueConstraint("assignment_id", "student_id", name="uq_submission"),)

    assignment_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("assignments.id", ondelete="CASCADE"), index=True)
    student_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), index=True)
    text: Mapped[str | None] = mapped_column(Text)
    link: Mapped[str | None] = mapped_column(String(500))
    handed_in_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    status: Mapped[str] = mapped_column(String(10), default="handed_in")       # handed_in, marked, missing, excused
    score: Mapped[float | None] = mapped_column(Float)
    feedback: Mapped[str | None] = mapped_column(String(600))
    marked_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    marked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Score(IdMixin, TimestampMixin, Base):
    """One mark on the score sheet: a student's CA1 (or CA1 › Test, or Exam) in one subject for one term."""
    __tablename__ = "scores"
    __table_args__ = (UniqueConstraint("term_id", "student_id", "subject_id", "component", name="uq_score"),)

    term_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("terms.id", ondelete="CASCADE"), index=True)
    student_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), index=True)
    subject_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("subjects.id", ondelete="CASCADE"), index=True)
    component: Mapped[str] = mapped_column(String(80))                          # "CA1", "CA1 › Test", "Exam"
    value: Mapped[float | None] = mapped_column(Float)
    absent: Mapped[bool] = mapped_column(Boolean, default=False)                # missed it (shown as "ABS")
    by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))


class SheetStatus(IdMixin, TimestampMixin, Base):
    """Whether a teacher has handed in a score sheet (a class's or a group's subject for a term)."""
    __tablename__ = "sheet_status"
    __table_args__ = (UniqueConstraint("term_id", "scope", name="uq_sheet_status"),)

    term_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("terms.id", ondelete="CASCADE"), index=True)
    scope: Mapped[str] = mapped_column(String(120))                             # "class:<id>:<subject id>" or "group:<id>"
    status: Mapped[str] = mapped_column(String(10), default="open")            # open, submitted
    by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    note: Mapped[str | None] = mapped_column(String(300))


class ReportCard(IdMixin, TimestampMixin, Base):
    __tablename__ = "report_cards"
    __table_args__ = (UniqueConstraint("term_id", "student_id", name="uq_report_card"),)

    term_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("terms.id", ondelete="CASCADE"), index=True)
    student_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), index=True)
    class_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("classes.id", ondelete="SET NULL"), index=True)
    traits: Mapped[dict] = mapped_column(JSON, default=dict)                    # {"Punctuality": 4, ...} rated 1 to 5
    teacher_comment: Mapped[str | None] = mapped_column(String(600))
    principal_comment: Mapped[str | None] = mapped_column(String(600))
    status: Mapped[str] = mapped_column(String(10), default="draft")           # draft, published
    snapshot: Mapped[dict | None] = mapped_column(JSON)                         # the card as published, so it never changes later
    code: Mapped[str | None] = mapped_column(String(12), unique=True)           # for checking a printed card is genuine
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    published_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))   # first opened by the family
