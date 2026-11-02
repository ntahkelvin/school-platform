"""How the school year and teaching are organised.

Session (e.g. 2026/2027) -> three Terms.  Classes belong to a branch (e.g. JSS 1A at Lekki).
Subjects are shared across all branches of a school.
"""
import uuid
from datetime import date, datetime

from sqlalchemy import JSON, Boolean, Date, DateTime, ForeignKey, Integer, String, UniqueConstraint
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
    unit_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("units.id", ondelete="SET NULL"))


class ClassSubject(IdMixin, TimestampMixin, Base):
    """A subject a class takes, and who teaches it to that class."""

    __tablename__ = "class_subjects"
    __table_args__ = (UniqueConstraint("class_id", "subject_id", name="uq_class_subject"),)

    class_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("classes.id", ondelete="CASCADE"), index=True)
    subject_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("subjects.id", ondelete="CASCADE"), index=True)
    teacher_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), index=True)
    compulsory: Mapped[bool] = mapped_column(Boolean, default=True)  # False: an elective only some students take
    periods: Mapped[int | None] = mapped_column(Integer)          # lessons a week (blank: the usual number for the subject)
    double: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")  # one double lesson a week (practicals)


class TeachingGroup(IdMixin, TimestampMixin, Base):
    """A group of students taking one elective subject with one teacher, drawn from every arm of a
    level, e.g. 'SS 1 Chemistry, Mr Okafor's group'."""

    __tablename__ = "teaching_groups"

    branch_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("branches.id", ondelete="CASCADE"), index=True)
    level: Mapped[str] = mapped_column(String(30))
    subject_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("subjects.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(100))
    teacher_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), index=True)
    capacity: Mapped[int | None] = mapped_column(Integer)
    periods: Mapped[int | None] = mapped_column(Integer)          # lessons a week


class StudentElective(IdMixin, TimestampMixin, Base):
    """An elective a student takes. One teacher (group) per subject per student."""

    __tablename__ = "student_electives"
    __table_args__ = (UniqueConstraint("student_id", "subject_id", name="uq_student_elective"),)

    student_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), index=True)
    subject_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("subjects.id", ondelete="CASCADE"), index=True)
    group_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("teaching_groups.id", ondelete="SET NULL"), index=True)



class TimetableSettings(IdMixin, TimestampMixin, Base):
    __tablename__ = "timetable_settings"

    school_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("schools.id", ondelete="CASCADE"), unique=True)
    days: Mapped[list] = mapped_column(JSON, default=lambda: [0, 1, 2, 3, 4])   # 0 = Monday
    max_same_day: Mapped[int] = mapped_column(Integer, default=2)               # most lessons of one subject in a day
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    built_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    report: Mapped[dict] = mapped_column(JSON, default=dict)                    # the last build: placed, missing, why


class TimetableSlot(IdMixin, TimestampMixin, Base):
    """One lesson in a class's week. kind 'block' means the class splits into its elective groups."""
    __tablename__ = "timetable_slots"
    __table_args__ = (UniqueConstraint("class_id", "weekday", "period_id", name="uq_timetable_slot"),)

    school_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("schools.id", ondelete="CASCADE"), index=True)
    class_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("classes.id", ondelete="CASCADE"), index=True)
    weekday: Mapped[int] = mapped_column(Integer)
    period_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("periods.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(10), default="lesson")            # lesson, block
    subject_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("subjects.id", ondelete="CASCADE"))
    teacher_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), index=True)
    block: Mapped[str | None] = mapped_column(String(30))                      # "Options 1"
    locked: Mapped[bool] = mapped_column(Boolean, default=False)


class TimetableGroupSlot(IdMixin, TimestampMixin, Base):
    """An elective group's lesson, taught while the level's classes are in an options block."""
    __tablename__ = "timetable_group_slots"
    __table_args__ = (UniqueConstraint("group_id", "weekday", "period_id", name="uq_timetable_group_slot"),)

    school_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("schools.id", ondelete="CASCADE"), index=True)
    group_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("teaching_groups.id", ondelete="CASCADE"), index=True)
    weekday: Mapped[int] = mapped_column(Integer)
    period_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("periods.id", ondelete="CASCADE"))
    teacher_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), index=True)
    block: Mapped[str | None] = mapped_column(String(30))


class CoverLesson(IdMixin, TimestampMixin, Base):
    """Someone taking a lesson for a teacher who is away."""
    __tablename__ = "cover_lessons"

    school_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("schools.id", ondelete="CASCADE"), index=True)
    on_date: Mapped[date] = mapped_column(Date, index=True)
    period_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("periods.id", ondelete="CASCADE"))
    class_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("classes.id", ondelete="CASCADE"))
    group_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("teaching_groups.id", ondelete="CASCADE"))
    subject_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("subjects.id", ondelete="SET NULL"))
    absent_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    cover_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), index=True)
    note: Mapped[str | None] = mapped_column(String(200))
    by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
