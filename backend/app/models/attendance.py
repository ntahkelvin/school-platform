"""Attendance: the daily class register, and the boarders' night roll call.

One row per student, per day, per kind of register. Saving the same register
again simply updates the rows, so a phone that re-sends after losing signal
never creates duplicates.
"""
import enum
import uuid
from datetime import date, datetime

from sqlalchemy import Date, DateTime, Enum, ForeignKey, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.models.mixins import IdMixin, TimestampMixin


class AttendanceKind(str, enum.Enum):
    school = "school"  # morning class register
    night = "night"    # boarding house roll call


class AttendanceStatus(str, enum.Enum):
    present = "present"
    absent = "absent"
    late = "late"
    excused = "excused"  # e.g. sick bay, approved exeat


class AttendanceRecord(IdMixin, TimestampMixin, Base):
    __tablename__ = "attendance_records"
    __table_args__ = (UniqueConstraint("student_id", "on_date", "kind", name="uq_attendance_student_day_kind"),)

    student_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), index=True)
    branch_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("branches.id", ondelete="CASCADE"), index=True)
    class_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("classes.id", ondelete="SET NULL"), index=True)
    on_date: Mapped[date] = mapped_column(Date, index=True)
    kind: Mapped[AttendanceKind] = mapped_column(Enum(AttendanceKind, name="attendance_kind"))
    status: Mapped[AttendanceStatus] = mapped_column(Enum(AttendanceStatus, name="attendance_status"))
    note: Mapped[str | None] = mapped_column(String(200))
    recorded_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
