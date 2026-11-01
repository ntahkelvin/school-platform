"""Staff quality and growth: lesson observations, appraisals, training (CPD), mentoring,
recognition, the weekly wellbeing check-in and the strengths map."""
import uuid
from datetime import date, datetime

from sqlalchemy import JSON, Boolean, Date, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.models.mixins import IdMixin, TimestampMixin


class GrowthSettings(IdMixin, TimestampMixin, Base):
    __tablename__ = "growth_settings"

    school_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("schools.id", ondelete="CASCADE"), unique=True)
    cpd_target_hours: Mapped[int] = mapped_column(Integer, default=30)      # training hours each person should reach in a year
    workload_limit: Mapped[int] = mapped_column(Integer, default=36)        # load points (about periods a week) before someone counts as overloaded
    observations_per_term: Mapped[int] = mapped_column(Integer, default=1)


class Observation(IdMixin, TimestampMixin, Base):
    """A lesson observation, scored on the school's teaching standards (1 to 4)."""
    __tablename__ = "lesson_observations"

    school_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("schools.id", ondelete="CASCADE"), index=True)
    teacher_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    observer_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    subject_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("subjects.id", ondelete="SET NULL"))
    class_label: Mapped[str | None] = mapped_column(String(60))
    on_date: Mapped[date] = mapped_column(Date, index=True)
    kind: Mapped[str] = mapped_column(String(12), default="formal")   # formal, drop_in (learning walk), peer
    focus: Mapped[str | None] = mapped_column(String(200))
    scores: Mapped[dict] = mapped_column(JSON, default=dict)          # {criterion key: 1..4}
    strengths: Mapped[str | None] = mapped_column(Text)
    next_steps: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(12), default="planned")  # planned, draft, shared, acknowledged
    teacher_comment: Mapped[str | None] = mapped_column(Text)
    shared_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    acknowledged_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Appraisal(IdMixin, TimestampMixin, Base):
    """A yearly (or termly) appraisal: the staff member reviews themselves, the appraiser reviews, both sign."""
    __tablename__ = "appraisals"
    __table_args__ = (UniqueConstraint("school_id", "user_id", "period_label", name="uq_appraisal_period"),)

    school_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("schools.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    appraiser_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), index=True)
    period_label: Mapped[str] = mapped_column(String(60))             # e.g. 2026/2027
    due_on: Mapped[date | None] = mapped_column(Date)
    status: Mapped[str] = mapped_column(String(12), default="self")   # self, review, sign, done
    self_scores: Mapped[dict] = mapped_column(JSON, default=dict)
    self_comment: Mapped[str | None] = mapped_column(Text)
    scores: Mapped[dict] = mapped_column(JSON, default=dict)
    appraiser_comment: Mapped[str | None] = mapped_column(Text)
    overall: Mapped[int | None] = mapped_column(Integer)              # 1..4
    goals: Mapped[list] = mapped_column(JSON, default=list)           # [{title, measure, due, progress 0..100}]
    staff_signed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    appraiser_signed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    staff_comment: Mapped[str | None] = mapped_column(Text)


class CpdRecord(IdMixin, TimestampMixin, Base):
    """Training and development: workshops, courses, conferences, in-school sessions."""
    __tablename__ = "cpd_records"

    school_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("schools.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(200))
    provider: Mapped[str | None] = mapped_column(String(120))
    kind: Mapped[str] = mapped_column(String(20), default="workshop")
    on_date: Mapped[date] = mapped_column(Date, index=True)
    hours: Mapped[float] = mapped_column(Float, default=1)
    notes: Mapped[str | None] = mapped_column(Text)
    impact: Mapped[str | None] = mapped_column(Text)                  # what I changed in my teaching because of it
    verified_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))


class Mentoring(IdMixin, TimestampMixin, Base):
    __tablename__ = "mentoring"

    school_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("schools.id", ondelete="CASCADE"), index=True)
    mentor_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    mentee_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    focus: Mapped[str] = mapped_column(String(200))
    started_on: Mapped[date] = mapped_column(Date)
    status: Mapped[str] = mapped_column(String(10), default="active")  # active, ended
    meetings: Mapped[list] = mapped_column(JSON, default=list)        # [{date, note, by}]


class Kudos(IdMixin, TimestampMixin, Base):
    """A thank-you or shout-out from one colleague to another."""
    __tablename__ = "kudos"

    school_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("schools.id", ondelete="CASCADE"), index=True)
    from_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    to_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    badge: Mapped[str] = mapped_column(String(30))
    message: Mapped[str] = mapped_column(String(400))
    cheers: Mapped[list] = mapped_column(JSON, default=list)          # user ids who added a cheer


class Pulse(IdMixin, TimestampMixin, Base):
    """The weekly wellbeing check-in. Only totals are ever shown to the school, never one person's answers."""
    __tablename__ = "wellbeing_pulse"
    __table_args__ = (UniqueConstraint("school_id", "user_id", "week_start", name="uq_pulse_week"),)

    school_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("schools.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    week_start: Mapped[date] = mapped_column(Date, index=True)
    mood: Mapped[int] = mapped_column(Integer)          # 1..5
    workload: Mapped[int] = mapped_column(Integer)      # 1 (light) .. 5 (too much)
    supported: Mapped[int] = mapped_column(Integer)     # 1..5, "I feel supported"
    wants_chat: Mapped[bool] = mapped_column(Boolean, default=False)   # would like a private chat with the counsellor/head
    note: Mapped[str | None] = mapped_column(String(500))              # private, seen only by them


class Strength(IdMixin, TimestampMixin, Base):
    __tablename__ = "staff_strengths"
    __table_args__ = (UniqueConstraint("school_id", "user_id", "skill", name="uq_strength"),)

    school_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("schools.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    skill: Mapped[str] = mapped_column(String(60))
    endorsed_by: Mapped[list] = mapped_column(JSON, default=list)
