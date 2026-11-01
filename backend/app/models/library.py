"""3C: the library, cleaning rotas and the asset register."""
import uuid
from datetime import date, datetime

from sqlalchemy import JSON, Boolean, Date, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.models.mixins import IdMixin, TimestampMixin


# ---------- Library ----------

class LibrarySettings(IdMixin, TimestampMixin, Base):
    __tablename__ = "library_settings"

    school_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("schools.id", ondelete="CASCADE"), unique=True)
    student_days: Mapped[int] = mapped_column(Integer, default=14)
    staff_days: Mapped[int] = mapped_column(Integer, default=30)
    student_max: Mapped[int] = mapped_column(Integer, default=2)
    staff_max: Mapped[int] = mapped_column(Integer, default=5)
    renewals: Mapped[int] = mapped_column(Integer, default=1)
    next_number: Mapped[int] = mapped_column(Integer, default=1)       # for accession numbers


class Book(IdMixin, TimestampMixin, Base):
    """A title in the catalogue. Each physical copy is a BookCopy with its own number."""
    __tablename__ = "books"

    school_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("schools.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(250))
    author: Mapped[str | None] = mapped_column(String(200))
    isbn: Mapped[str | None] = mapped_column(String(20), index=True)
    publisher: Mapped[str | None] = mapped_column(String(120))
    year: Mapped[int | None] = mapped_column(Integer)
    category: Mapped[str] = mapped_column(String(20), default="textbook")   # textbook, literature, fiction, reference, religious, magazine, other
    subject: Mapped[str | None] = mapped_column(String(80))
    level: Mapped[str | None] = mapped_column(String(40))                   # JSS 1, SS 2, All
    shelf: Mapped[str | None] = mapped_column(String(40))
    summary: Mapped[str | None] = mapped_column(Text)
    colour: Mapped[str | None] = mapped_column(String(9))


class BookCopy(IdMixin, TimestampMixin, Base):
    __tablename__ = "book_copies"
    __table_args__ = (UniqueConstraint("school_id", "number", name="uq_book_copy_number"),)

    school_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("schools.id", ondelete="CASCADE"), index=True)
    book_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("books.id", ondelete="CASCADE"), index=True)
    number: Mapped[str] = mapped_column(String(20))                         # accession number, e.g. L00042
    status: Mapped[str] = mapped_column(String(12), default="available")    # available, on_loan, lost, damaged, withdrawn
    condition: Mapped[str] = mapped_column(String(10), default="good")      # new, good, fair, poor
    note: Mapped[str | None] = mapped_column(String(200))


class Loan(IdMixin, TimestampMixin, Base):
    __tablename__ = "loans"

    school_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("schools.id", ondelete="CASCADE"), index=True)
    copy_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("book_copies.id", ondelete="CASCADE"), index=True)
    book_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("books.id", ondelete="CASCADE"), index=True)
    student_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)   # a staff borrower
    issued_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    issued_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    due_on: Mapped[date] = mapped_column(Date)
    returned_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    returned_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    renewals: Mapped[int] = mapped_column(Integer, default=0)
    outcome: Mapped[str | None] = mapped_column(String(10))                 # returned, lost, damaged
    note: Mapped[str | None] = mapped_column(String(200))


class BookHold(IdMixin, TimestampMixin, Base):
    """Someone wants a book that is out: they are next in the queue."""
    __tablename__ = "book_holds"

    school_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("schools.id", ondelete="CASCADE"), index=True)
    book_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("books.id", ondelete="CASCADE"), index=True)
    student_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"))
    user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    status: Mapped[str] = mapped_column(String(10), default="waiting")       # waiting, done, cancelled


# ---------- Cleaning ----------

class CleanArea(IdMixin, TimestampMixin, Base):
    """A place that gets cleaned on a rota: a classroom block, toilets, a dormitory, the compound."""
    __tablename__ = "clean_areas"

    school_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("schools.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(120))
    kind: Mapped[str] = mapped_column(String(15), default="other")      # classroom, toilet, hostel, compound, office, hall, kitchen, other
    facility_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("facilities.id", ondelete="SET NULL"))
    hostel_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("hostels.id", ondelete="SET NULL"))
    days: Mapped[list] = mapped_column(JSON, default=lambda: [0, 1, 2, 3, 4])   # weekdays, Monday = 0
    shift: Mapped[str] = mapped_column(String(10), default="morning")    # morning, afternoon, evening
    checklist: Mapped[list] = mapped_column(JSON, default=list)          # ["Sweep", "Mop", "Empty the bins"]
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class CleanDuty(IdMixin, TimestampMixin, Base):
    """Who cleans an area on which days: a cleaner on the staff, or a group of students (labour / dormitory duty)."""
    __tablename__ = "clean_duties"

    school_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("schools.id", ondelete="CASCADE"), index=True)
    area_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("clean_areas.id", ondelete="CASCADE"), index=True)
    weekday: Mapped[int] = mapped_column(Integer)                        # 0..6
    user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    team: Mapped[str | None] = mapped_column(String(100))                # e.g. "JSS 3 boys", "St Theresa House, room 2"


class CleanLog(IdMixin, TimestampMixin, Base):
    __tablename__ = "clean_logs"
    __table_args__ = (UniqueConstraint("area_id", "on_date", name="uq_clean_log"),)

    school_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("schools.id", ondelete="CASCADE"), index=True)
    area_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("clean_areas.id", ondelete="CASCADE"), index=True)
    on_date: Mapped[date] = mapped_column(Date, index=True)
    done_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    done_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    ticked: Mapped[list] = mapped_column(JSON, default=list)
    photo: Mapped[str | None] = mapped_column(Text)
    score: Mapped[int | None] = mapped_column(Integer)                   # 1..5 from the inspector
    inspected_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    inspected_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    comment: Mapped[str | None] = mapped_column(String(300))


# ---------- Assets ----------

class Asset(IdMixin, TimestampMixin, Base):
    """One thing the school owns, with its own tag: a projector, 30 lockers, a generator, a microscope."""
    __tablename__ = "assets"
    __table_args__ = (UniqueConstraint("school_id", "tag", name="uq_asset_tag"),)

    school_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("schools.id", ondelete="CASCADE"), index=True)
    tag: Mapped[str] = mapped_column(String(30))
    name: Mapped[str] = mapped_column(String(150))
    category: Mapped[str] = mapped_column(String(15), default="other")   # furniture, ict, lab, kitchen, electrical, sports, office, music, other
    make_model: Mapped[str | None] = mapped_column(String(120))
    serial_no: Mapped[str | None] = mapped_column(String(80))
    facility_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("facilities.id", ondelete="SET NULL"), index=True)
    location: Mapped[str | None] = mapped_column(String(120))            # when not a facility
    assigned_to_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    supplier: Mapped[str | None] = mapped_column(String(120))
    purchase_date: Mapped[date | None] = mapped_column(Date)
    cost: Mapped[float | None] = mapped_column(Float)
    life_years: Mapped[int | None] = mapped_column(Integer)
    warranty_until: Mapped[date | None] = mapped_column(Date)
    condition: Mapped[str] = mapped_column(String(10), default="good")   # new, good, fair, poor, broken
    status: Mapped[str] = mapped_column(String(10), default="in_use")    # in_use, in_store, repair, lost, disposed
    photo: Mapped[str | None] = mapped_column(Text)
    notes: Mapped[str | None] = mapped_column(String(500))
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    history: Mapped[list] = mapped_column(JSON, default=list)            # [{at, by, text}]


class AssetCount(IdMixin, TimestampMixin, Base):
    """A stock-take: walk round, scan or tick what is there, and see what is missing."""
    __tablename__ = "asset_counts"

    school_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("schools.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(120))
    facility_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("facilities.id", ondelete="SET NULL"))
    started_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    found: Mapped[dict] = mapped_column(JSON, default=dict)              # asset id -> {at, by, condition}
