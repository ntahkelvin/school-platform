"""A staff member's work record at one school: position, department and HR details.
Their login and contact details live on User; what they may do in the app is a Membership."""
import enum
import uuid
from datetime import date

from sqlalchemy import Boolean, Date, Enum, ForeignKey, String, UniqueConstraint
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

    department = relationship("Department", lazy="joined")
    unit = relationship("Unit", lazy="joined")
