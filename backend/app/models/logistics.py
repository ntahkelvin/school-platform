"""Kitchen, store and transport."""
import uuid
from datetime import date, datetime

from sqlalchemy import JSON, Boolean, Date, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.models.mixins import IdMixin, TimestampMixin


# ---------- Kitchen ----------

class KitchenSettings(IdMixin, TimestampMixin, Base):
    __tablename__ = "kitchen_settings"

    school_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("schools.id", ondelete="CASCADE"), unique=True)
    meals: Mapped[list] = mapped_column(JSON, default=lambda: ["breakfast", "lunch", "supper"])
    day_students_lunch: Mapped[bool] = mapped_column(Boolean, default=True)
    staff_meals: Mapped[int] = mapped_column(Integer, default=0)      # staff plates at lunch


class MealPlan(IdMixin, TimestampMixin, Base):
    """What is on the menu for one meal on one day."""
    __tablename__ = "meal_plans"
    __table_args__ = (UniqueConstraint("school_id", "on_date", "meal", name="uq_meal_plan"),)

    school_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("schools.id", ondelete="CASCADE"), index=True)
    on_date: Mapped[date] = mapped_column(Date, index=True)
    meal: Mapped[str] = mapped_column(String(12))
    dishes: Mapped[str] = mapped_column(String(300))
    notes: Mapped[str | None] = mapped_column(String(200))


class MealService(IdMixin, TimestampMixin, Base):
    """What actually happened at a meal: plates served and food left over."""
    __tablename__ = "meal_services"
    __table_args__ = (UniqueConstraint("school_id", "on_date", "meal", name="uq_meal_service"),)

    school_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("schools.id", ondelete="CASCADE"), index=True)
    on_date: Mapped[date] = mapped_column(Date, index=True)
    meal: Mapped[str] = mapped_column(String(12))
    expected: Mapped[int] = mapped_column(Integer, default=0)
    served: Mapped[int] = mapped_column(Integer, default=0)
    leftover: Mapped[str] = mapped_column(String(10), default="little")   # none, little, some, lots
    rating: Mapped[int | None] = mapped_column(Integer)                   # how it went, 1..5, from the kitchen
    notes: Mapped[str | None] = mapped_column(String(300))
    recorded_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))


# ---------- Store (and kitchen food store) ----------

class StockItem(IdMixin, TimestampMixin, Base):
    __tablename__ = "stock_items"

    school_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("schools.id", ondelete="CASCADE"), index=True)
    store: Mapped[str] = mapped_column(String(12), default="main")      # main (general store) or kitchen
    name: Mapped[str] = mapped_column(String(120))
    category: Mapped[str] = mapped_column(String(20), default="other")
    unit: Mapped[str] = mapped_column(String(20), default="piece")
    quantity: Mapped[float] = mapped_column(Float, default=0)
    reorder_level: Mapped[float] = mapped_column(Float, default=0)
    unit_cost: Mapped[float | None] = mapped_column(Float)              # naira, from the last delivery
    location: Mapped[str | None] = mapped_column(String(80))
    notes: Mapped[str | None] = mapped_column(String(200))
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class StockMove(IdMixin, TimestampMixin, Base):
    """Every change to stock: a delivery in, an issue out, or a count that corrects it."""
    __tablename__ = "stock_moves"

    school_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("schools.id", ondelete="CASCADE"), index=True)
    item_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("stock_items.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(8))                         # in, out, count
    quantity: Mapped[float] = mapped_column(Float)                       # always positive; count = the difference
    balance: Mapped[float] = mapped_column(Float)                        # stock after this move
    unit_cost: Mapped[float | None] = mapped_column(Float)
    supplier: Mapped[str | None] = mapped_column(String(120))
    issued_to: Mapped[str | None] = mapped_column(String(120))
    ticket_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("tickets.id", ondelete="SET NULL"))
    note: Mapped[str | None] = mapped_column(String(200))
    by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))


# ---------- Transport ----------

class VehicleCheck(IdMixin, TimestampMixin, Base):
    """The driver's check before the first trip of the day."""
    __tablename__ = "vehicle_checks"

    school_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("schools.id", ondelete="CASCADE"), index=True)
    vehicle_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("vehicles.id", ondelete="CASCADE"), index=True)
    on_date: Mapped[date] = mapped_column(Date, index=True)
    items: Mapped[dict] = mapped_column(JSON, default=dict)              # {key: true/false}
    all_ok: Mapped[bool] = mapped_column(Boolean, default=True)
    odometer: Mapped[int | None] = mapped_column(Integer)
    notes: Mapped[str | None] = mapped_column(String(300))
    by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    ticket_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("tickets.id", ondelete="SET NULL"))


class Trip(IdMixin, TimestampMixin, Base):
    __tablename__ = "vehicle_trips"

    school_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("schools.id", ondelete="CASCADE"), index=True)
    vehicle_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("vehicles.id", ondelete="CASCADE"), index=True)
    driver_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    kind: Mapped[str] = mapped_column(String(12), default="errand")     # school_run, excursion, errand, hospital, market, other
    purpose: Mapped[str] = mapped_column(String(200))
    destination: Mapped[str | None] = mapped_column(String(120))
    passengers: Mapped[int | None] = mapped_column(Integer)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    odometer_start: Mapped[int | None] = mapped_column(Integer)
    odometer_end: Mapped[int | None] = mapped_column(Integer)
    notes: Mapped[str | None] = mapped_column(String(300))


class FuelLog(IdMixin, TimestampMixin, Base):
    __tablename__ = "fuel_logs"

    school_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("schools.id", ondelete="CASCADE"), index=True)
    vehicle_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("vehicles.id", ondelete="CASCADE"), index=True)
    on_date: Mapped[date] = mapped_column(Date, index=True)
    litres: Mapped[float] = mapped_column(Float)
    cost: Mapped[float] = mapped_column(Float)
    odometer: Mapped[int | None] = mapped_column(Integer)
    station: Mapped[str | None] = mapped_column(String(80))
    by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))


class VehicleService(IdMixin, TimestampMixin, Base):
    """Servicing, repairs, tyres and the yearly papers."""
    __tablename__ = "vehicle_services"

    school_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("schools.id", ondelete="CASCADE"), index=True)
    vehicle_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("vehicles.id", ondelete="CASCADE"), index=True)
    on_date: Mapped[date] = mapped_column(Date, index=True)
    kind: Mapped[str] = mapped_column(String(12), default="service")    # service, repair, tyres, battery, papers, other
    description: Mapped[str] = mapped_column(String(200))
    cost: Mapped[float | None] = mapped_column(Float)
    odometer: Mapped[int | None] = mapped_column(Integer)
    garage: Mapped[str | None] = mapped_column(String(120))
    by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))


class BusRoute(IdMixin, TimestampMixin, Base):
    __tablename__ = "bus_routes"

    school_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("schools.id", ondelete="CASCADE"), index=True)
    vehicle_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("vehicles.id", ondelete="SET NULL"))
    name: Mapped[str] = mapped_column(String(80))
    stops: Mapped[list] = mapped_column(JSON, default=list)             # [{name, morning: "06:45", afternoon: "15:20"}]
    driver_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    attendant_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))


class RouteRider(IdMixin, TimestampMixin, Base):
    __tablename__ = "route_riders"
    __table_args__ = (UniqueConstraint("route_id", "student_id", name="uq_route_rider"),)

    route_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("bus_routes.id", ondelete="CASCADE"), index=True)
    student_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), index=True)
    stop: Mapped[str | None] = mapped_column(String(80))


class BusRegister(IdMixin, TimestampMixin, Base):
    """Who got on the bus, and the check that every child got off."""
    __tablename__ = "bus_registers"
    __table_args__ = (UniqueConstraint("route_id", "on_date", "run", name="uq_bus_register"),)

    school_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("schools.id", ondelete="CASCADE"), index=True)
    route_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("bus_routes.id", ondelete="CASCADE"), index=True)
    on_date: Mapped[date] = mapped_column(Date, index=True)
    run: Mapped[str] = mapped_column(String(10))                          # morning or afternoon
    boarded: Mapped[list] = mapped_column(JSON, default=list)            # student ids
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    all_off_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))   # bus checked empty at the end
    by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    notes: Mapped[str | None] = mapped_column(Text)
