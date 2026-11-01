"""A staff member's work record at one school: position, department and HR details.
Their login and contact details live on User; what they may do in the app is a Membership."""
import enum
import uuid
from datetime import date

from sqlalchemy import JSON, Boolean, Date, Enum, ForeignKey, Integer, LargeBinary, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base
from app.models.mixins import IdMixin, TimestampMixin
from app.models.people import Gender


class EmploymentType(str, enum.Enum):
    full_time = "full_time"
    part_time = "part_time"
    contract = "contract"
    nysc = "nysc"            # NYSC corps member
    volunteer = "volunteer"


class StaffProfile(IdMixin, TimestampMixin, Base):
    __tablename__ = "staff_profiles"
    __table_args__ = (UniqueConstraint("school_id", "user_id", name="uq_staff_profile_school_user"),)

    school_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("schools.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    staff_no: Mapped[str | None] = mapped_column(String(40))
    title: Mapped[str | None] = mapped_column(String(30))            # Mr, Mrs, Rev Fr, Sr, Dr...
    gender: Mapped[Gender | None] = mapped_column(Enum(Gender, name="gender", create_type=False))
    job_title: Mapped[str | None] = mapped_column(String(100))       # Principal, Chemistry Teacher, Bursar...
    department_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("departments.id", ondelete="SET NULL"))
    unit_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("units.id", ondelete="SET NULL"))
    teaching: Mapped[bool] = mapped_column(Boolean, default=True)
    employment_type: Mapped[EmploymentType] = mapped_column(
        Enum(EmploymentType, name="employment_type"), default=EmploymentType.full_time
    )
    date_joined: Mapped[date | None] = mapped_column(Date)
    qualification: Mapped[str | None] = mapped_column(String(100))  # B.Sc. Ed, NCE, M.Sc...

    # Personal details
    photo: Mapped[str | None] = mapped_column(Text)                  # small image, stored as a data URL
    date_of_birth: Mapped[date | None] = mapped_column(Date)
    address: Mapped[str | None] = mapped_column(String(300))
    state_of_origin: Mapped[str | None] = mapped_column(String(50))
    lga: Mapped[str | None] = mapped_column(String(80))
    marital_status: Mapped[str | None] = mapped_column(String(20))
    religion: Mapped[str | None] = mapped_column(String(30))
    next_of_kin_name: Mapped[str | None] = mapped_column(String(200))
    next_of_kin_relationship: Mapped[str | None] = mapped_column(String(40))
    next_of_kin_phone: Mapped[str | None] = mapped_column(String(32))
    next_of_kin_address: Mapped[str | None] = mapped_column(String(300))
    # Teaching registration
    trcn_number: Mapped[str | None] = mapped_column(String(40))      # Teachers Registration Council of Nigeria
    trcn_expiry: Mapped[date | None] = mapped_column(Date)
    subjects_trained: Mapped[list] = mapped_column(JSON, default=list)  # subject names they are trained to teach
    # Pay (only owner, principal and bursar see these)
    grade_level: Mapped[str | None] = mapped_column(String(20))
    step: Mapped[str | None] = mapped_column(String(10))
    bank_name: Mapped[str | None] = mapped_column(String(80))
    account_number: Mapped[str | None] = mapped_column(String(20))
    account_name: Mapped[str | None] = mapped_column(String(200))

    department = relationship("Department", lazy="joined")
    unit = relationship("Unit", lazy="joined")


class StaffQualification(IdMixin, TimestampMixin, Base):
    __tablename__ = "staff_qualifications"

    school_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("schools.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(150))                  # B.Sc. Ed Chemistry
    institution: Mapped[str | None] = mapped_column(String(200))
    year: Mapped[int | None] = mapped_column(Integer)
    kind: Mapped[str] = mapped_column(String(30), default="degree")  # degree, diploma, nce, certificate, professional, other


class StaffDocument(IdMixin, TimestampMixin, Base):
    __tablename__ = "staff_documents"

    school_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("schools.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(40))                    # cv, appointment_letter, certificate, id, trcn, other
    filename: Mapped[str] = mapped_column(String(200))
    content_type: Mapped[str] = mapped_column(String(100))
    size: Mapped[int] = mapped_column(Integer)
    data: Mapped[bytes] = mapped_column(LargeBinary)
    uploaded_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
