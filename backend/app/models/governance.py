"""Boards: the organisation's trustees/directors, and each school's board of governors."""
import uuid
from datetime import date

from sqlalchemy import Date, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base
from app.models.mixins import IdMixin, TimestampMixin


class Board(IdMixin, TimestampMixin, Base):
    __tablename__ = "boards"

    group_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("school_groups.id", ondelete="CASCADE"), index=True)
    school_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("schools.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(100))  # e.g. "Board of Trustees", "Board of Governors"

    members: Mapped[list["BoardMember"]] = relationship(
        cascade="all, delete-orphan", order_by="BoardMember.position_order", lazy="selectin"
    )


class BoardMember(IdMixin, TimestampMixin, Base):
    __tablename__ = "board_members"

    board_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("boards.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    position: Mapped[str] = mapped_column(String(50))  # Chairman, Secretary, Treasurer, Trustee, Member...
    position_order: Mapped[int] = mapped_column(Integer, default=99)
    term_start: Mapped[date | None] = mapped_column(Date)
    term_end: Mapped[date | None] = mapped_column(Date)

    user = relationship("User", lazy="joined")
