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


class ResultSettings(IdMixin, TimestampMixin, Base):
    """How a school checks and releases scores."""
    __tablename__ = "result_settings"

    school_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("schools.id", ondelete="CASCADE"), unique=True)
    checks: Mapped[int] = mapped_column(Integer, default=1)                     # 1: unit head (or HOD if none). 2: unit head, then HOD
    confirm_days: Mapped[int] = mapped_column(Integer, default=5)               # school days students have to confirm or query
    # A missed test (ABS, or 0.1 typed): "substitute" uses the nearest score of the same kind (CE1 <- CE2), else leaves it out;
    # "reweight" leaves it out and shares its weight among the rest; "zero" counts it as 0.
    absent_rule: Mapped[str] = mapped_column(String(12), default="substitute", server_default="substitute")
    rank_by: Mapped[str] = mapped_column(String(8), default="class", server_default="class")      # "class" or "level" (all arms of a year)
    # Awards by term average, best first: [{"name": "Honours", "min": 88.5, "top": null}, {"name": "Merits", "min": 85}]
    awards: Mapped[list] = mapped_column(JSON, default=list, server_default="[]")
    # When a student goes on probation: {"line": 50, "fails": 3, "drop": 10}
    probation: Mapped[dict] = mapped_column(JSON, default=dict, server_default="{}")


class AssessmentWindow(IdMixin, TimestampMixin, Base):
    """The deadline for typing one test's marks (CA1, CA2, Exam) in one term. After it, the sheet closes by itself."""
    __tablename__ = "assessment_windows"
    __table_args__ = (UniqueConstraint("term_id", "component", name="uq_assessment_window"),)

    school_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("schools.id", ondelete="CASCADE"), index=True)
    term_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("terms.id", ondelete="CASCADE"), index=True)
    component: Mapped[str] = mapped_column(String(50))
    closes_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))


class WindowOpening(IdMixin, TimestampMixin, Base):
    """The principal, VP or ICT opening a closed test again, for one teacher or for everyone, until a set time."""
    __tablename__ = "window_openings"

    school_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("schools.id", ondelete="CASCADE"), index=True)
    term_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("terms.id", ondelete="CASCADE"), index=True)
    component: Mapped[str] = mapped_column(String(50))
    teacher_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))   # empty: every teacher
    until: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    reason: Mapped[str | None] = mapped_column(String(300))
    by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))


class SheetStep(IdMixin, TimestampMixin, Base):
    """Where one test on one score sheet has got to: typing, handed in, with the unit head or HOD, sent back or approved."""
    __tablename__ = "sheet_steps"
    __table_args__ = (UniqueConstraint("term_id", "scope", "component", name="uq_sheet_step"),)

    term_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("terms.id", ondelete="CASCADE"), index=True)
    scope: Mapped[str] = mapped_column(String(120), index=True)
    component: Mapped[str] = mapped_column(String(50))
    status: Mapped[str] = mapped_column(String(10), default="draft")           # draft, submitted, returned, approved
    stage: Mapped[int] = mapped_column(Integer, default=0)                      # which check it is waiting for (0 first, 1 second)
    waiting_for_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), index=True)
    row_notes: Mapped[dict] = mapped_column(JSON, default=dict)                 # {student id: what to fix} when sent back
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))  # first approval: students see it from then
    history: Mapped[list] = mapped_column(JSON, default=list)                   # [{at, by, action, note}]


class ComponentRelease(IdMixin, TimestampMixin, Base):
    """One test's scores published to families for one class. Published tests carry a padlock until someone opens them again."""
    __tablename__ = "component_releases"
    __table_args__ = (UniqueConstraint("term_id", "class_id", "component", name="uq_component_release"),)

    term_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("terms.id", ondelete="CASCADE"), index=True)
    class_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("classes.id", ondelete="CASCADE"), index=True)
    component: Mapped[str] = mapped_column(String(50))
    locked: Mapped[bool] = mapped_column(Boolean, default=True)
    published_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    snapshot: Mapped[dict] = mapped_column(JSON, default=dict)                  # {student id: {subject: {"marks": {...}, "total": n}}} as families see it
    history: Mapped[list] = mapped_column(JSON, default=list)


class ScoreBookEntry(IdMixin, TimestampMixin, Base):
    """What a student wrote down from their marked script, to compare with the official mark."""
    __tablename__ = "score_book"
    __table_args__ = (UniqueConstraint("term_id", "student_id", "subject_id", "key", name="uq_score_book"),)

    term_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("terms.id", ondelete="CASCADE"), index=True)
    student_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), index=True)
    subject_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("subjects.id", ondelete="CASCADE"))
    key: Mapped[str] = mapped_column(String(80))                                # "CA1", "CA1 › Test", "Exam"
    value: Mapped[float] = mapped_column(Float)
    photo: Mapped[str | None] = mapped_column(Text)                             # a photo of the script (small JPEG data URL)
    note: Mapped[str | None] = mapped_column(String(300))


class ScoreCheck(IdMixin, TimestampMixin, Base):
    """A student's answer to an approved test in one subject: confirmed, or queried (and how the query went)."""
    __tablename__ = "score_checks"
    __table_args__ = (UniqueConstraint("term_id", "student_id", "subject_id", "component", name="uq_score_check"),)

    term_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("terms.id", ondelete="CASCADE"), index=True)
    student_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), index=True)
    subject_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("subjects.id", ondelete="CASCADE"))
    component: Mapped[str] = mapped_column(String(50))
    scope: Mapped[str] = mapped_column(String(120), index=True)
    # confirmed, queried, answered (teacher kept the mark), escalated (with the head), correcting, corrected, closed (head kept it)
    status: Mapped[str] = mapped_column(String(12), default="confirmed")
    query_text: Mapped[str | None] = mapped_column(String(600))
    claimed: Mapped[float | None] = mapped_column(Float)
    query_photo: Mapped[str | None] = mapped_column(Text)
    reply: Mapped[str | None] = mapped_column(String(600))
    answered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    history: Mapped[list] = mapped_column(JSON, default=list)


class ProbationCase(IdMixin, TimestampMixin, Base):
    """A student whose results show they are failing, and the plan everyone follows to help them."""
    __tablename__ = "probation_cases"
    __table_args__ = (UniqueConstraint("term_id", "student_id", name="uq_probation_case"),)

    school_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("schools.id", ondelete="CASCADE"), index=True)
    term_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("terms.id", ondelete="CASCADE"), index=True)
    student_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), index=True)
    status: Mapped[str] = mapped_column(String(12), default="open")    # open, plan, review, improved, closed
    average: Mapped[float | None] = mapped_column(Float, nullable=True)
    reasons: Mapped[list] = mapped_column(JSON, default=list)            # ["Average 46% is below 50%", ...]
    weak: Mapped[list] = mapped_column(JSON, default=list)               # [{"subject_id", "subject", "pct"}]
    team: Mapped[list] = mapped_column(JSON, default=list)               # [{"id", "name", "role"}] everyone told and helping
    family_told: Mapped[bool] = mapped_column(Boolean, default=False)    # only once the marks behind it are published
    plan: Mapped[str | None] = mapped_column(Text, nullable=True)
    actions: Mapped[list] = mapped_column(JSON, default=list)            # [{"id", "what", "who", "due", "done"}]
    meetings: Mapped[list] = mapped_column(JSON, default=list)           # [{"id", "on", "with", "notes", "by"}]
    review_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    parent_ack_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    parent_ack_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    parent_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    history: Mapped[list] = mapped_column(JSON, default=list)
