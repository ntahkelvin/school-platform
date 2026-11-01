"""How schools are organised: School group -> School -> Branch.

A solo school is simply a group with one school and one branch.
"""
import enum
import uuid

from sqlalchemy import Boolean, Enum, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base
from app.models.mixins import IdMixin, TimestampMixin


class SchoolType(str, enum.Enum):
    day = "day"
    boarding = "boarding"
    mixed = "mixed"


class SchoolGroup(IdMixin, TimestampMixin, Base):
    """An organisation that runs one or more schools, e.g. the Society of Jesus, or a single proprietor."""

    __tablename__ = "school_groups"

    name: Mapped[str] = mapped_column(String(200))
    logo: Mapped[str | None] = mapped_column(Text)
    description: Mapped[str | None] = mapped_column(String(1000))
    address: Mapped[str | None] = mapped_column(String(500))
    phone: Mapped[str | None] = mapped_column(String(50))
    email: Mapped[str | None] = mapped_column(String(255))
    website: Mapped[str | None] = mapped_column(String(255))

    schools: Mapped[list["School"]] = relationship(
        back_populates="group", cascade="all, delete-orphan", order_by="School.name"
    )


class School(IdMixin, TimestampMixin, Base):
    __tablename__ = "schools"

    group_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("school_groups.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    school_type: Mapped[SchoolType] = mapped_column(Enum(SchoolType, name="school_type"), default=SchoolType.day)

    # Profile
    motto: Mapped[str | None] = mapped_column(String(200))
    logo: Mapped[str | None] = mapped_column(Text)  # small image, stored as a data URL
    address: Mapped[str | None] = mapped_column(String(500))
    state: Mapped[str | None] = mapped_column(String(50))
    lga: Mapped[str | None] = mapped_column(String(100))
    phone: Mapped[str | None] = mapped_column(String(50))
    email: Mapped[str | None] = mapped_column(String(255))
    website: Mapped[str | None] = mapped_column(String(255))
    founded_year: Mapped[int | None] = mapped_column(Integer)
    colour: Mapped[str | None] = mapped_column(String(9))
    approval_number: Mapped[str | None] = mapped_column(String(100))  # Ministry of Education approval
    waec_centre_no: Mapped[str | None] = mapped_column(String(50))
    neco_centre_no: Mapped[str | None] = mapped_column(String(50))
    head_title: Mapped[str | None] = mapped_column(String(40))   # what this school calls its head of school: President, Rector...

    group: Mapped[SchoolGroup] = relationship(back_populates="schools")
    # Each school has exactly one campus record behind the scenes; the screens never show it as a "branch".
    branches: Mapped[list["Branch"]] = relationship(
        back_populates="school", cascade="all, delete-orphan", order_by="Branch.created_at"
    )

    @property
    def campus_id(self) -> uuid.UUID | None:
        return self.branches[0].id if self.branches else None

    @property
    def has_boarding(self) -> bool:
        return self.school_type != SchoolType.day


class Branch(IdMixin, TimestampMixin, Base):
    __tablename__ = "branches"

    school_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("schools.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    address: Mapped[str | None] = mapped_column(String(500))
    phone: Mapped[str | None] = mapped_column(String(50))
    email: Mapped[str | None] = mapped_column(String(255))
    has_boarding: Mapped[bool] = mapped_column(Boolean, default=False)

    school: Mapped[School] = relationship(back_populates="branches")
