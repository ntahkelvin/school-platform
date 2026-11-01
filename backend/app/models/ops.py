"""School operations run by non-teaching staff: the helpdesk (repairs, IT, store, cleaning),
the gate (visitors and student exit passes), incident reports and the sick bay."""
import uuid
from datetime import date, datetime

from sqlalchemy import JSON, Boolean, Date, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.models.mixins import IdMixin, TimestampMixin


class DeskMember(IdMixin, TimestampMixin, Base):
    """Who works on each desk: gate, sick bay, maintenance, IT, store, transport..."""
    __tablename__ = "desk_members"
    __table_args__ = (UniqueConstraint("school_id", "desk", "user_id", name="uq_desk_member"),)

    school_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("schools.id", ondelete="CASCADE"), index=True)
    desk: Mapped[str] = mapped_column(String(20))
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    lead: Mapped[bool] = mapped_column(Boolean, default=False)
    # Taken off the desk by a manager: kept so the automatic matching by job title doesn't put them back.
    removed: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")


class Ticket(IdMixin, TimestampMixin, Base):
    """A job for the helpdesk: a broken fan, a leaking tap, a printer, chalk from the store..."""
    __tablename__ = "tickets"

    school_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("schools.id", ondelete="CASCADE"), index=True)
    number: Mapped[int] = mapped_column(Integer)
    desk: Mapped[str] = mapped_column(String(20), index=True)
    category: Mapped[str] = mapped_column(String(30))
    title: Mapped[str] = mapped_column(String(200))
    details: Mapped[str | None] = mapped_column(Text)
    location: Mapped[str | None] = mapped_column(String(120))
    facility_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("facilities.id", ondelete="SET NULL"))
    asset_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("assets.id", ondelete="SET NULL"), index=True)
    priority: Mapped[str] = mapped_column(String(10), default="normal")    # low, normal, urgent
    status: Mapped[str] = mapped_column(String(12), default="new")          # new, assigned, working, waiting, done, closed
    raised_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), index=True)
    assigned_to_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), index=True)
    due_on: Mapped[date | None] = mapped_column(Date)
    photo: Mapped[str | None] = mapped_column(Text)                           # small picture as a data URL
    done_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    rating: Mapped[int | None] = mapped_column(Integer)                       # 1..5 from the person who raised it
    feedback: Mapped[str | None] = mapped_column(String(300))
    cost: Mapped[float | None] = mapped_column(Float)                         # naira spent on parts, if any
    comments: Mapped[list] = mapped_column(JSON, default=list)               # [{at, by, name, text}]


class Visitor(IdMixin, TimestampMixin, Base):
    __tablename__ = "visitors"

    school_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("schools.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(12), default="visitor")   # visitor, parent, contractor, delivery, official
    name: Mapped[str] = mapped_column(String(120))
    phone: Mapped[str | None] = mapped_column(String(30))
    organisation: Mapped[str | None] = mapped_column(String(120))
    purpose: Mapped[str] = mapped_column(String(200))
    to_see: Mapped[str | None] = mapped_column(String(120))
    to_see_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    student_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("students.id", ondelete="SET NULL"))
    badge: Mapped[str | None] = mapped_column(String(20))
    vehicle: Mapped[str | None] = mapped_column(String(30))
    people: Mapped[int] = mapped_column(Integer, default=1)
    time_in: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    time_out: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    logged_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    note: Mapped[str | None] = mapped_column(String(300))


class GatePass(IdMixin, TimestampMixin, Base):
    """Permission for a student to leave the school. The gate checks it on the way out and back."""
    __tablename__ = "gate_passes"

    school_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("schools.id", ondelete="CASCADE"), index=True)
    student_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), index=True)
    code: Mapped[str] = mapped_column(String(8), index=True)
    kind: Mapped[str] = mapped_column(String(12), default="home")      # home, hospital, errand, family, excursion, other
    reason: Mapped[str] = mapped_column(String(300))
    leave_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    return_by: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    escort_name: Mapped[str | None] = mapped_column(String(120))
    escort_phone: Mapped[str | None] = mapped_column(String(30))
    escort_relation: Mapped[str | None] = mapped_column(String(40))
    status: Mapped[str] = mapped_column(String(10), default="requested")  # requested, approved, declined, out, returned, cancelled
    requested_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    approved_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    decision_note: Mapped[str | None] = mapped_column(String(300))
    left_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    returned_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    out_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    in_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))


class Incident(IdMixin, TimestampMixin, Base):
    __tablename__ = "incidents"

    school_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("schools.id", ondelete="CASCADE"), index=True)
    number: Mapped[int] = mapped_column(Integer)
    kind: Mapped[str] = mapped_column(String(20))           # injury, fight, bullying, theft, damage, security, fire, health, other
    severity: Mapped[str] = mapped_column(String(10), default="minor")   # minor, serious, critical
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    location: Mapped[str | None] = mapped_column(String(120))
    summary: Mapped[str] = mapped_column(String(200))
    description: Mapped[str | None] = mapped_column(Text)
    student_ids: Mapped[list] = mapped_column(JSON, default=list)
    staff_ids: Mapped[list] = mapped_column(JSON, default=list)
    others: Mapped[str | None] = mapped_column(String(300))
    action_taken: Mapped[str | None] = mapped_column(Text)
    reported_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    assigned_to_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    status: Mapped[str] = mapped_column(String(14), default="open")      # open, investigating, closed
    outcome: Mapped[str | None] = mapped_column(Text)
    parents_informed: Mapped[bool] = mapped_column(Boolean, default=False)
    notes: Mapped[list] = mapped_column(JSON, default=list)              # [{at, by, name, text}]


class StudentHealth(IdMixin, TimestampMixin, Base):
    __tablename__ = "student_health"

    student_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), unique=True)
    blood_group: Mapped[str | None] = mapped_column(String(5))
    genotype: Mapped[str | None] = mapped_column(String(5))
    allergies: Mapped[str | None] = mapped_column(String(300))
    conditions: Mapped[str | None] = mapped_column(String(300))       # asthma, sickle cell, epilepsy...
    medications: Mapped[str | None] = mapped_column(String(300))
    diet: Mapped[str | None] = mapped_column(String(200))             # e.g. no pork, vegetarian, no groundnuts (the kitchen sees this)
    hospital: Mapped[str | None] = mapped_column(String(150))         # family doctor or hospital
    notes: Mapped[str | None] = mapped_column(Text)
    updated_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))


class ClinicVisit(IdMixin, TimestampMixin, Base):
    __tablename__ = "clinic_visits"

    school_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("schools.id", ondelete="CASCADE"), index=True)
    student_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), index=True)
    staff_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    complaint: Mapped[str] = mapped_column(String(200))
    symptoms: Mapped[list] = mapped_column(JSON, default=list)        # fever, headache, stomach, vomiting, cough, injury...
    temperature: Mapped[float | None] = mapped_column(Float)
    treatment: Mapped[str | None] = mapped_column(Text)
    medicines: Mapped[list] = mapped_column(JSON, default=list)       # [{stock_id, name, quantity, dose}]
    outcome: Mapped[str] = mapped_column(String(14), default="class")  # class, rest, sick_bay, home, hospital
    parent_informed: Mapped[bool] = mapped_column(Boolean, default=False)
    follow_up_on: Mapped[date | None] = mapped_column(Date)
    discharged_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))   # for those kept in the sick bay
    nurse_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))


class MedicineStock(IdMixin, TimestampMixin, Base):
    __tablename__ = "medicine_stock"

    school_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("schools.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(120))
    unit: Mapped[str] = mapped_column(String(20), default="tablet")
    quantity: Mapped[float] = mapped_column(Float, default=0)
    reorder_level: Mapped[float] = mapped_column(Float, default=10)
    expiry: Mapped[date | None] = mapped_column(Date)
    notes: Mapped[str | None] = mapped_column(String(200))
