"""Rights: what each role (or one person) may see and change, temporary access to private records,
notices to the principal, and a log of sensitive actions."""
import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.models.mixins import IdMixin, TimestampMixin


class RightSetting(IdMixin, TimestampMixin, Base):
    """A change from the ready-made rights, for a whole role or for one person, in one school."""
    __tablename__ = "right_settings"
    __table_args__ = (UniqueConstraint("school_id", "role", "user_id", "right", name="uq_right_setting"),)

    school_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("schools.id", ondelete="CASCADE"), index=True)
    role: Mapped[str | None] = mapped_column(String(30))                       # set for a role
    user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))  # or for one person
    right: Mapped[str] = mapped_column(String(40))
    allowed: Mapped[bool] = mapped_column(Boolean)
    changed_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))


class AccessGrant(IdMixin, TimestampMixin, Base):
    """Someone asks to open private records for a while; the principal says yes or no."""
    __tablename__ = "access_grants"

    school_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("schools.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    right: Mapped[str] = mapped_column(String(40))
    reason: Mapped[str] = mapped_column(String(500))
    hours: Mapped[int] = mapped_column(Integer, default=24)
    status: Mapped[str] = mapped_column(String(10), default="waiting")        # waiting, approved, refused, ended
    decided_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    note: Mapped[str | None] = mapped_column(String(300))


class Notice(IdMixin, TimestampMixin, Base):
    """A message for one person, shown under the bell."""
    __tablename__ = "notices"

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    school_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("schools.id", ondelete="CASCADE"))
    kind: Mapped[str] = mapped_column(String(20))            # request, private, see_as, info
    icon: Mapped[str] = mapped_column(String(30), default="bell")
    text: Mapped[str] = mapped_column(String(400))
    link: Mapped[str | None] = mapped_column(String(200))
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class AuditEntry(IdMixin, TimestampMixin, Base):
    """Sensitive things that happened: someone used 'see as', or opened or changed private records."""
    __tablename__ = "audit_entries"

    school_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("schools.id", ondelete="CASCADE"), index=True)
    actor_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    action: Mapped[str] = mapped_column(String(20))          # see_as, private_open, private_change, rights, grant
    what: Mapped[str] = mapped_column(String(300))
    key: Mapped[str | None] = mapped_column(String(120), index=True)   # to avoid repeating the same notice
