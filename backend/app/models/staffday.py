"""A staff member's working day: signing in and out, leave, duties and lesson notes."""
import uuid
from datetime import date, datetime, time

from sqlalchemy import JSON, Boolean, Date, DateTime, Float, ForeignKey, Integer, String, Text, Time, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.models.mixins import IdMixin, TimestampMixin


class StaffDaySettings(IdMixin, TimestampMixin, Base):
    __tablename__ = "staff_day_settings"

    school_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("schools.id", ondelete="CASCADE"), unique=True)
    day_starts: Mapped[time] = mapped_column(Time, default=time(7, 30))
    late_after: Mapped[time] = mapped_column(Time, default=time(7, 45))
    day_ends: Mapped[time] = mapped_column(Time, default=time(16, 0))
    work_days: Mapped[list] = mapped_column(JSON, default=lambda: [0, 1, 2, 3, 4])   # Monday = 0
    kiosk_token: Mapped[str] = mapped_column(String(64))
    allow_self: Mapped[bool] = mapped_column(Boolean, default=True)
    latitude: Mapped[float | None] = mapped_column(Float)      # school location for "I'm in" on a phone
    longitude: Mapped[float | None] = mapped_column(Float)
    radius_m: Mapped[int] = mapped_column(Integer, default=300)


class StaffAttendance(IdMixin, TimestampMixin, Base):
    __tablename__ = "staff_attendance"
    __table_args__ = (UniqueConstraint("school_id", "user_id", "on_date", name="uq_staff_attendance_day"),)

    school_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("schools.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    on_date: Mapped[date] = mapped_column(Date, index=True)
    status: Mapped[str] = mapped_column(String(20))            # present, late, absent, excused
    time_in: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    time_out: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    method_in: Mapped[str | None] = mapped_column(String(10))  # scan, self, admin
    method_out: Mapped[str | None] = mapped_column(String(10))
    marked_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    note: Mapped[str | None] = mapped_column(String(200))


class LeaveRequest(IdMixin, TimestampMixin, Base):
    __tablename__ = "leave_requests"

    school_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("schools.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(20))              # sick, casual, annual, maternity, paternity, study, compassionate, other
    starts_on: Mapped[date] = mapped_column(Date)
    ends_on: Mapped[date] = mapped_column(Date)
    reason: Mapped[str | None] = mapped_column(String(500))
    status: Mapped[str] = mapped_column(String(12), default="pending")  # pending, approved, declined, cancelled
    decided_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    decision_note: Mapped[str | None] = mapped_column(String(300))
    cover_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))


class DutyAssignment(IdMixin, TimestampMixin, Base):
    __tablename__ = "duty_assignments"

    school_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("schools.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    duty: Mapped[str] = mapped_column(String(80))              # Teacher on duty, Prep supervision...
    on_date: Mapped[date] = mapped_column(Date, index=True)
    note: Mapped[str | None] = mapped_column(String(200))


class LessonNote(IdMixin, TimestampMixin, Base):
    __tablename__ = "lesson_notes"

    school_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("schools.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(12), default="note")   # note (weekly lesson note) or scheme (scheme of work)
    subject_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("subjects.id", ondelete="CASCADE"), index=True)
    level: Mapped[str] = mapped_column(String(40))             # e.g. JSS 2 or SS 1
    week_starting: Mapped[date | None] = mapped_column(Date)
    term_label: Mapped[str | None] = mapped_column(String(40))
    topic: Mapped[str] = mapped_column(String(200))
    objectives: Mapped[str | None] = mapped_column(Text)
    content: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(12), default="draft")  # draft, submitted, approved, returned
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    reviewer_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    review_note: Mapped[str | None] = mapped_column(String(500))
