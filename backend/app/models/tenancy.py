"""How schools are organised: School group -> School -> Branch.

A solo school is simply a group with one school and one branch.
"""
import enum
import uuid

from sqlalchemy import Boolean, Enum, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base
from app.models.mixins import IdMixin, TimestampMixin


class SchoolType(str, enum.Enum):
    day = "day"
    boarding = "boarding"
    mixed = "mixed"


class SchoolGroup(IdMixin, TimestampMixin, Base):
    __tablename__ = "school_groups"

    name: Mapped[str] = mapped_column(String(200))

    schools: Mapped[list["School"]] = relationship(
        back_populates="group", cascade="all, delete-orphan", order_by="School.name"
    )


class School(IdMixin, TimestampMixin, Base):
    __tablename__ = "schools"

    group_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("school_groups.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    school_type: Mapped[SchoolType] = mapped_column(Enum(SchoolType, name="school_type"), default=SchoolType.day)

    group: Mapped[SchoolGroup] = relationship(back_populates="schools")
    branches: Mapped[list["Branch"]] = relationship(
        back_populates="school", cascade="all, delete-orphan", order_by="Branch.name"
    )


class Branch(IdMixin, TimestampMixin, Base):
    __tablename__ = "branches"

    school_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("schools.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    address: Mapped[str | None] = mapped_column(String(500))
    has_boarding: Mapped[bool] = mapped_column(Boolean, default=False)

    school: Mapped[School] = relationship(back_populates="branches")
