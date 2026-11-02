"""People and what they are allowed to do.

One person = one User (one login). What they do is stored as Memberships,
so the same person can be a teacher at one branch and a parent at another.
"""
import enum
import uuid

from datetime import datetime

from sqlalchemy import Boolean, CheckConstraint, DateTime, Enum, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base
from app.models.mixins import IdMixin, TimestampMixin


class Role(str, enum.Enum):
    owner = "owner"            # proprietor: sees the whole group
    head_of_school = "head_of_school"  # above the principal: President, Rector, Head of School (the school picks the title)
    head = "head"              # principal / head teacher
    vice_principal = "vice_principal"  # helps the principal run the school
    it_admin = "it_admin"      # the school's IT team: logins, uploads and set-up
    bursar = "bursar"          # fees and money
    teacher = "teacher"
    house_parent = "house_parent"  # boarding welfare
    parent = "parent"
    student = "student"
    board_member = "board_member"
    support = "support"        # non-teaching staff: listed as staff, no special access yet  # read-only view of the organisation or one school


class User(IdMixin, TimestampMixin, Base):
    __tablename__ = "users"
    __table_args__ = (CheckConstraint("email IS NOT NULL OR phone IS NOT NULL OR username IS NOT NULL", name="user_has_contact"),)

    full_name: Mapped[str] = mapped_column(String(200))
    email: Mapped[str | None] = mapped_column(String(255), unique=True)
    phone: Mapped[str | None] = mapped_column(String(32), unique=True)
    username: Mapped[str | None] = mapped_column(String(60), unique=True)   # students log in with this (their admission number)
    password_hash: Mapped[str] = mapped_column(String(255))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    # Set when someone else chose the password (a new login or a reset): they pick their own at next login.
    must_change_password: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    memberships: Mapped[list["Membership"]] = relationship(back_populates="user", cascade="all, delete-orphan")


class Membership(IdMixin, TimestampMixin, Base):
    """A role a user holds, and where it applies.

    group only        -> applies to every school and branch in the group (e.g. owner)
    group + school    -> applies to every branch of that school (e.g. head)
    group + branch    -> applies to one branch (e.g. teacher)
    """

    __tablename__ = "memberships"

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    role: Mapped[Role] = mapped_column(Enum(Role, name="role"))
    group_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("school_groups.id", ondelete="CASCADE"), index=True)
    school_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("schools.id", ondelete="CASCADE"))
    branch_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("branches.id", ondelete="CASCADE"))

    user: Mapped[User] = relationship(back_populates="memberships")
