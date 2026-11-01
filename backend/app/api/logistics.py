"""Kitchen, store and transport.

Kitchen: how many plates to cook for each meal (worked out from boarders in school, students out on passes,
students in the sick bay, day students in school and staff), the weekly menu, special diets and allergies,
what was served and left over, and the food store.
Store: every item, every delivery in and issue out, counts, a shopping list worked out from what is used.
Transport: each vehicle's papers, daily checks, trips, fuel and servicing, bus routes, and the bus register
that makes sure every child who got on also got off.
"""
import uuid
from collections import Counter, defaultdict
from datetime import date, datetime, time, timedelta, timezone
from statistics import mean

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.api.access import not_found
from app.api.deps import current_user
from app.api.ops import Names, need_desk, on_desk, student_card
from app.api.staff_day import WAT, now_wat, school_for, staff_ids
from app.core.db import get_db
from app.models import (
    AttendanceRecord, Branch, BusRegister, BusRoute, ClinicVisit, FuelLog, GatePass, KitchenSettings, MealPlan, MealService,
    RouteRider, School, StockItem, StockMove, Student, StudentHealth, Ticket, Trip, User, Vehicle, VehicleCheck, VehicleService,
)
from app.models.attendance import AttendanceKind, AttendanceStatus
from app.models.people import BoardingStatus, StudentStatus

router = APIRouter(prefix="/api", tags=["kitchen, store and transport"])

MEALS = {"breakfast": "Breakfast", "lunch": "Lunch", "supper": "Supper", "snack": "Snack"}
LEFTOVER = {"none": "None", "little": "A little", "some": "Some", "lots": "A lot"}
CATEGORIES = {
    "main": {"stationery": "Stationery", "cleaning": "Cleaning", "maintenance": "Maintenance parts", "ict": "ICT", "sports": "Sports",
             "uniform": "Uniforms", "toiletries": "Toiletries", "other": "Other"},
    "kitchen": {"grains": "Rice, beans and grains", "protein": "Meat, fish and eggs", "vegetables": "Vegetables and fruit",
                "oil": "Oil, spices and seasoning", "drinks": "Drinks and beverages", "fuel": "Gas and firewood", "other": "Other"},
}
CHECK_ITEMS = {"tyres": "Tyres", "lights": "Lights and indicators", "brakes": "Brakes", "oil": "Engine oil", "water": "Radiator water",
               "horn": "Horn and wipers", "seatbelts": "Seat belts", "first_aid": "First aid kit", "extinguisher": "Fire extinguisher",
               "clean": "Clean inside"}
TRIP_KINDS = {"school_run": "School run", "excursion": "Excursion or competition", "errand": "Errand", "hospital": "Hospital",
              "market": "Market or supplies", "other": "Other"}
SERVICE_KINDS = {"service": "Routine service", "repair": "Repair", "tyres": "Tyres", "battery": "Battery", "papers": "Papers renewed", "other": "Other"}


@router.get("/logistics/meta")
def meta(user: User = Depends(current_user)):
    return {"meals": MEALS, "leftover": LEFTOVER, "categories": CATEGORIES, "check_items": CHECK_ITEMS, "trip_kinds": TRIP_KINDS, "service_kinds": SERVICE_KINDS}


def units(q: float, unit: str) -> str:
    """3 bags, 1 bag, 2.5 litres."""
    plural = q != 1 and not unit.endswith("s") and unit not in ("kg", "g")
    return f"{q:g} {unit}{'es' if plural and unit.endswith(('x', 'ch', 'sh')) else 's' if plural else ''}"


def store_desk(store: str) -> str:
    return "kitchen" if store == "kitchen" else "store"


# =====================================================================
# Kitchen
# =====================================================================

def kitchen_settings(db: Session, school_id: uuid.UUID) -> KitchenSettings:
    st = db.scalar(select(KitchenSettings).where(KitchenSettings.school_id == school_id))
    if not st:
        st = KitchenSettings(school_id=school_id, meals=["breakfast", "lunch", "supper"], day_students_lunch=True, staff_meals=0)
        db.add(st)
        db.flush()
    return st


class KitchenSettingsIO(BaseModel):
    meals: list[str] = Field(min_length=1)
    day_students_lunch: bool
    staff_meals: int = Field(ge=0, le=1000)


@router.get("/schools/{school_id}/kitchen/settings", response_model=KitchenSettingsIO)
def get_kitchen_settings(school_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    school_for(db, user, school_id)
    st = kitchen_settings(db, school_id)
    db.commit()
    return KitchenSettingsIO(meals=st.meals, day_students_lunch=st.day_students_lunch, staff_meals=st.staff_meals)


@router.put("/schools/{school_id}/kitchen/settings", response_model=KitchenSettingsIO)
def put_kitchen_settings(school_id: uuid.UUID, data: KitchenSettingsIO, user: User = Depends(current_user), db: Session = Depends(get_db)):
    need_desk(db, user, school_id, "kitchen")
    if any(m not in MEALS for m in data.meals):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Unknown meal")
    st = kitchen_settings(db, school_id)
    st.meals = [m for m in MEALS if m in data.meals]
    st.day_students_lunch, st.staff_meals = data.day_students_lunch, data.staff_meals
    db.commit()
    return data


def head_count(db: Session, school_id: uuid.UUID, day: date) -> dict:
    """Who will eat today."""
    active = select(Student.id).where(Student.school_id == school_id, Student.status == StudentStatus.active)
    boarders = set(db.scalars(active.where(Student.boarding_status == BoardingStatus.boarder)))
    day_ids = set(db.scalars(active.where(Student.boarding_status == BoardingStatus.day)))
    start = datetime.combine(day, time(0), WAT)
    end = start + timedelta(days=1)
    out = set(db.scalars(select(GatePass.student_id).where(
        GatePass.school_id == school_id, GatePass.left_at.is_not(None), GatePass.left_at < end,
        or_(GatePass.returned_at.is_(None), GatePass.returned_at >= start), GatePass.status.in_(["out", "returned"]))))
    if day == now_wat().date():
        out = set(db.scalars(select(GatePass.student_id).where(GatePass.school_id == school_id, GatePass.status == "out")))
    in_bay = set(db.scalars(select(ClinicVisit.student_id).where(
        ClinicVisit.school_id == school_id, ClinicVisit.outcome == "sick_bay", ClinicVisit.seen_at < end,
        or_(ClinicVisit.discharged_at.is_(None), ClinicVisit.discharged_at >= end))))
    sent_home = set(db.scalars(select(ClinicVisit.student_id).where(
        ClinicVisit.school_id == school_id, ClinicVisit.outcome.in_(["home", "hospital"]), ClinicVisit.seen_at >= start - timedelta(days=2), ClinicVisit.seen_at < end)))
    boarders_out = (out | sent_home) & boarders
    sick = (in_bay & boarders) - boarders_out
    marked = list(db.execute(select(AttendanceRecord.student_id, AttendanceRecord.status).where(
        AttendanceRecord.on_date == day, AttendanceRecord.kind == AttendanceKind.school, AttendanceRecord.student_id.in_(day_ids or {uuid.uuid4()}))))
    if marked:
        day_present = sum(1 for _, s in marked if s in (AttendanceStatus.present, AttendanceStatus.late))
        day_source = f"from today's registers ({len(marked)} of {len(day_ids)} marked)"
        unmarked = len(day_ids) - len(marked)
        day_present += unmarked   # classes not yet marked: assume they're in
    else:
        day_present, day_source = len(day_ids), "registers not taken yet: all day students counted"
    return {"boarders": len(boarders), "boarders_out": len(boarders_out), "sick_bay": len(sick), "dining_boarders": len(boarders) - len(boarders_out) - len(sick),
            "day_students": len(day_ids), "day_present": day_present, "day_source": day_source}


@router.get("/schools/{school_id}/kitchen/day")
def kitchen_day(school_id: uuid.UUID, on: date | None = Query(None, alias="date"), user: User = Depends(current_user), db: Session = Depends(get_db)):
    school = school_for(db, user, school_id)
    kitchen = on_desk(db, user, school, "kitchen")
    st = kitchen_settings(db, school_id)
    day = on or now_wat().date()
    hc = head_count(db, school_id, day)
    plans = {p.meal: p for p in db.scalars(select(MealPlan).where(MealPlan.school_id == school_id, MealPlan.on_date == day))}
    services = {s.meal: s for s in db.scalars(select(MealService).where(MealService.school_id == school_id, MealService.on_date == day))}
    meals = []
    for m in st.meals:
        expected = hc["dining_boarders"]
        parts = [f"{hc['dining_boarders']} boarders"]
        if m == "lunch":
            if st.day_students_lunch:
                expected += hc["day_present"]
                parts.append(f"{hc['day_present']} day students")
            if st.staff_meals:
                expected += st.staff_meals
                parts.append(f"{st.staff_meals} staff")
        s = services.get(m)
        meals.append({"meal": m, "label": MEALS[m], "expected": expected, "cook_for": int(round(expected * 1.03 + 0.49)), "made_of": parts,
                      "sick_bay_trays": hc["sick_bay"], "dishes": plans[m].dishes if m in plans else None, "notes": plans[m].notes if m in plans else None,
                      "served": s.served if s else None, "leftover": s.leftover if s else None, "rating": s.rating if s else None,
                      "service_notes": s.notes if s else None})
    diets = []
    if kitchen:
        rows = db.execute(select(Student, StudentHealth).join(StudentHealth, StudentHealth.student_id == Student.id).where(
            Student.school_id == school_id, Student.status == StudentStatus.active,
            or_(StudentHealth.allergies.is_not(None), StudentHealth.diet.is_not(None))))
        for s, h in rows:
            diets.append({**student_card(db, s), "allergies": h.allergies, "diet": h.diet})
        diets.sort(key=lambda x: (not x["boarder"], x["name"]))
    db.commit()
    return {"date": day.isoformat(), "count": hc, "meals": meals, "diets": diets, "can_edit": kitchen,
            "settings": {"meals": st.meals, "day_students_lunch": st.day_students_lunch, "staff_meals": st.staff_meals},
            "insights": kitchen_insights(db, school_id) if kitchen and day == now_wat().date() else []}


def kitchen_insights(db: Session, school_id: uuid.UUID) -> list[dict]:
    today = now_wat().date()
    tips = []
    rows = list(db.scalars(select(MealService).where(MealService.school_id == school_id, MealService.on_date >= today - timedelta(days=21))))
    plans = {(p.on_date, p.meal): p.dishes for p in db.scalars(select(MealPlan).where(MealPlan.school_id == school_id, MealPlan.on_date >= today - timedelta(days=21)))}
    wasted = Counter(plans.get((r.on_date, r.meal)) for r in rows if r.leftover == "lots" and plans.get((r.on_date, r.meal)))
    for dish, n in wasted.most_common(2):
        if n >= 2:
            tips.append({"kind": "tip", "icon": "utensils", "text": f"“{dish}” had a lot left over {n} times in 3 weeks. Students may not like it: try a change or smaller portions."})
    over = [r for r in rows if r.expected and r.served and r.served < r.expected * 0.85]
    if len(over) >= 3:
        gap = round(mean(r.expected - r.served for r in over))
        tips.append({"kind": "tip", "icon": "scale", "text": f"{len(over)} meals in 3 weeks served about {gap} fewer plates than expected. Check the numbers before cooking to save food."})
    mon = today - timedelta(days=today.weekday())
    nxt = mon + timedelta(days=7)
    planned = db.scalar(select(func.count()).select_from(MealPlan).where(MealPlan.school_id == school_id, MealPlan.on_date >= nxt, MealPlan.on_date < nxt + timedelta(days=7))) or 0
    if not planned:
        tips.append({"kind": "tip", "icon": "calendar-days", "text": "Next week's menu isn't planned yet. Copy this week's and change what you need."})
    low = list(db.scalars(select(StockItem).where(StockItem.school_id == school_id, StockItem.store == "kitchen", StockItem.active.is_(True),
                                                   StockItem.quantity <= StockItem.reorder_level)))
    if low:
        tips.append({"kind": "alert", "icon": "store", "text": "Food running low: " + ", ".join(f"{i.name} ({units(i.quantity, i.unit)})" for i in low[:5]) + "."})
    return tips


class MenuIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    on_date: date
    meal: str
    dishes: str = Field(default="", max_length=300)
    notes: str | None = Field(default=None, max_length=200)


@router.get("/schools/{school_id}/kitchen/menu")
def menu(school_id: uuid.UUID, week: date | None = None, user: User = Depends(current_user), db: Session = Depends(get_db)):
    school = school_for(db, user, school_id)
    mon = (week or now_wat().date())
    mon = mon - timedelta(days=mon.weekday())
    rows = db.scalars(select(MealPlan).where(MealPlan.school_id == school_id, MealPlan.on_date >= mon, MealPlan.on_date < mon + timedelta(days=7)))
    st = kitchen_settings(db, school_id)
    db.commit()
    return {"week": mon.isoformat(), "meals": st.meals, "can_edit": on_desk(db, user, school, "kitchen"),
            "plan": [{"on_date": p.on_date.isoformat(), "meal": p.meal, "dishes": p.dishes, "notes": p.notes} for p in rows]}


@router.put("/schools/{school_id}/kitchen/menu")
def set_menu(school_id: uuid.UUID, data: MenuIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    need_desk(db, user, school_id, "kitchen")
    if data.meal not in MEALS:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Unknown meal")
    p = db.scalar(select(MealPlan).where(MealPlan.school_id == school_id, MealPlan.on_date == data.on_date, MealPlan.meal == data.meal))
    if not data.dishes:
        if p:
            db.delete(p)
    else:
        if not p:
            p = MealPlan(school_id=school_id, on_date=data.on_date, meal=data.meal)
            db.add(p)
        p.dishes, p.notes = data.dishes, data.notes
    db.commit()
    return {"ok": True}


class CopyIn(BaseModel):
    from_week: date
    to_week: date


@router.post("/schools/{school_id}/kitchen/menu/copy")
def copy_menu(school_id: uuid.UUID, data: CopyIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    need_desk(db, user, school_id, "kitchen")
    a = data.from_week - timedelta(days=data.from_week.weekday())
    b = data.to_week - timedelta(days=data.to_week.weekday())
    if a == b:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Choose a different week")
    n = 0
    for p in list(db.scalars(select(MealPlan).where(MealPlan.school_id == school_id, MealPlan.on_date >= a, MealPlan.on_date < a + timedelta(days=7)))):
        d = b + (p.on_date - a)
        q = db.scalar(select(MealPlan).where(MealPlan.school_id == school_id, MealPlan.on_date == d, MealPlan.meal == p.meal))
        if not q:
            db.add(MealPlan(school_id=school_id, on_date=d, meal=p.meal, dishes=p.dishes, notes=p.notes))
            n += 1
    db.commit()
    return {"copied": n}


class ServiceIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    on_date: date
    meal: str
    served: int = Field(ge=0, le=20000)
    leftover: str = Field(pattern="^(none|little|some|lots)$")
    rating: int | None = Field(default=None, ge=1, le=5)
    notes: str | None = Field(default=None, max_length=300)


@router.put("/schools/{school_id}/kitchen/service")
def record_service(school_id: uuid.UUID, data: ServiceIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    need_desk(db, user, school_id, "kitchen")
    if data.meal not in MEALS:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Unknown meal")
    if data.on_date > now_wat().date():
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "That meal hasn't happened yet")
    day = kitchen_day(school_id, data.on_date, user, db)
    expected = next((m["expected"] for m in day["meals"] if m["meal"] == data.meal), 0)
    s = db.scalar(select(MealService).where(MealService.school_id == school_id, MealService.on_date == data.on_date, MealService.meal == data.meal))
    if not s:
        s = MealService(school_id=school_id, on_date=data.on_date, meal=data.meal)
        db.add(s)
    s.expected, s.served, s.leftover, s.rating, s.notes, s.recorded_by_id = expected, data.served, data.leftover, data.rating, data.notes, user.id
    db.commit()
    return {"ok": True}


# =====================================================================
# Store
# =====================================================================

def need_store(db: Session, user: User, school_id: uuid.UUID, store: str) -> School:
    if store not in CATEGORIES:
        raise not_found("Store")
    school = school_for(db, user, school_id)
    if not (on_desk(db, user, school, store_desk(store)) or on_desk(db, user, school, "store")):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the store or kitchen team can do this")
    return school


def usage(db: Session, school_id: uuid.UUID, days: int = 30) -> dict[uuid.UUID, float]:
    since = datetime.now(timezone.utc) - timedelta(days=days)
    out: dict = defaultdict(float)
    for item_id, q in db.execute(select(StockMove.item_id, StockMove.quantity).where(StockMove.school_id == school_id, StockMove.kind == "out",
                                                                                     StockMove.created_at >= since)):
        out[item_id] += q
    return out


def item_out(i: StockItem, used30: float, last_move: datetime | None = None) -> dict:
    per_day = used30 / 30
    return {"id": str(i.id), "store": i.store, "name": i.name, "category": i.category,
            "category_label": CATEGORIES.get(i.store, {}).get(i.category, i.category), "unit": i.unit, "quantity": i.quantity,
            "reorder_level": i.reorder_level, "unit_cost": i.unit_cost, "value": round(i.quantity * (i.unit_cost or 0), 2), "location": i.location,
            "notes": i.notes, "used_30": used30, "days_left": round(i.quantity / per_day) if per_day > 0 else None,
            "status": "out" if i.quantity <= 0 else "low" if i.quantity <= i.reorder_level else "ok",
            "last_move": last_move.isoformat() if last_move else None}


@router.get("/schools/{school_id}/stock")
def list_stock(school_id: uuid.UUID, store: str = "main", user: User = Depends(current_user), db: Session = Depends(get_db)):
    need_store(db, user, school_id, store)
    used = usage(db, school_id)
    last = dict(db.execute(select(StockMove.item_id, func.max(StockMove.created_at)).where(StockMove.school_id == school_id).group_by(StockMove.item_id)).all())
    items = list(db.scalars(select(StockItem).where(StockItem.school_id == school_id, StockItem.store == store, StockItem.active.is_(True)).order_by(StockItem.name)))
    rows = [item_out(i, used.get(i.id, 0), last.get(i.id)) for i in items]
    tips = []
    where = "Kitchen store" if store == "kitchen" else "Store"
    out_ = [r for r in rows if r["status"] == "out"]
    low = [r for r in rows if r["status"] == "low"]
    soon = [r for r in rows if r["status"] == "ok" and r["days_left"] is not None and r["days_left"] <= 14]
    if out_:
        tips.append({"kind": "alert", "icon": "circle-x", "text": f"{where}: out of " + ", ".join(r["name"] for r in out_[:6]) + "."})
    if low:
        tips.append({"kind": "alert", "icon": "store", "text": f"{where}: {len(low)} item{'s are' if len(low) > 1 else ' is'} below the reorder level. See the shopping list."})
    if soon:
        tips.append({"kind": "tip", "icon": "hourglass", "text": f"{where}: at the rate they're being used, these run out within 2 weeks: "
                     + ", ".join(f"{r['name']} (~{r['days_left']} days)" for r in sorted(soon, key=lambda r: r["days_left"])[:5]) + "."})
    stale = [r for r in rows if r["quantity"] > 0 and (not r["last_move"] or datetime.fromisoformat(r["last_move"]) < datetime.now(timezone.utc) - timedelta(days=90))]
    if len(stale) >= 3:
        tips.append({"kind": "tip", "icon": "history", "text": f"{where}: {len(stale)} items haven't moved in 3 months. Check they're still useful, or use them up."})
    db.commit()
    return {"store": store, "categories": CATEGORIES[store], "items": rows, "value": round(sum(r["value"] for r in rows), 2), "insights": tips}


class ItemIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    store: str = "main"
    name: str = Field(min_length=2, max_length=120)
    category: str = "other"
    unit: str = Field(default="piece", max_length=20)
    quantity: float = Field(default=0, ge=0, le=10_000_000)
    reorder_level: float = Field(default=0, ge=0, le=10_000_000)
    unit_cost: float | None = Field(default=None, ge=0, le=100_000_000)
    location: str | None = Field(default=None, max_length=80)
    notes: str | None = Field(default=None, max_length=200)


@router.post("/schools/{school_id}/stock", status_code=201)
def add_item(school_id: uuid.UUID, data: ItemIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    need_store(db, user, school_id, data.store)
    if data.category not in CATEGORIES[data.store]:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Choose a category")
    if db.scalar(select(StockItem.id).where(StockItem.school_id == school_id, StockItem.store == data.store, StockItem.active.is_(True),
                                            func.lower(StockItem.name) == data.name.lower())):
        raise HTTPException(status.HTTP_409_CONFLICT, "That item is already in the store")
    i = StockItem(school_id=school_id, **data.model_dump())
    db.add(i)
    db.flush()
    if data.quantity:
        db.add(StockMove(school_id=school_id, item_id=i.id, kind="count", quantity=data.quantity, balance=data.quantity, note="Opening stock", by_id=user.id))
    db.commit()
    return item_out(i, 0)


@router.put("/stock/{item_id}")
def edit_item(item_id: uuid.UUID, data: ItemIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    i = db.get(StockItem, item_id)
    if not i:
        raise not_found("Item")
    need_store(db, user, i.school_id, i.store)
    for k in ("name", "category", "unit", "reorder_level", "unit_cost", "location", "notes"):
        setattr(i, k, getattr(data, k))
    db.commit()
    return item_out(i, usage(db, i.school_id).get(i.id, 0))


@router.delete("/stock/{item_id}", status_code=204)
def remove_item(item_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    i = db.get(StockItem, item_id)
    if not i:
        raise not_found("Item")
    need_store(db, user, i.school_id, i.store)
    i.active = False
    db.commit()
    return Response(status_code=204)


class MoveIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    kind: str = Field(pattern="^(in|out|count)$")
    quantity: float = Field(ge=0, le=10_000_000)         # for a count: what you counted
    unit_cost: float | None = Field(default=None, ge=0, le=100_000_000)
    supplier: str | None = Field(default=None, max_length=120)
    issued_to: str | None = Field(default=None, max_length=120)
    note: str | None = Field(default=None, max_length=200)
    ticket_id: uuid.UUID | None = None


def apply_move(db: Session, i: StockItem, data: MoveIn, user: User) -> StockMove:
    if data.kind == "in":
        if data.quantity <= 0:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "How many came in?")
        i.quantity += data.quantity
        if data.unit_cost is not None:
            i.unit_cost = data.unit_cost
        q = data.quantity
    elif data.kind == "out":
        if data.quantity <= 0:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "How many are going out?")
        if data.quantity > i.quantity:
            raise HTTPException(status.HTTP_409_CONFLICT, f"Only {units(i.quantity, i.unit)} of {i.name} in the store")
        i.quantity -= data.quantity
        q = data.quantity
    else:
        q = abs(data.quantity - i.quantity)
        i.quantity = data.quantity
    m = StockMove(school_id=i.school_id, item_id=i.id, kind=data.kind, quantity=q, balance=i.quantity, unit_cost=data.unit_cost,
                  supplier=data.supplier, issued_to=data.issued_to, note=data.note, ticket_id=data.ticket_id, by_id=user.id)
    db.add(m)
    return m


@router.post("/stock/{item_id}/move")
def move(item_id: uuid.UUID, data: MoveIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    i = db.get(StockItem, item_id)
    if not i or not i.active:
        raise not_found("Item")
    need_store(db, user, i.school_id, i.store)
    apply_move(db, i, data, user)
    db.commit()
    return item_out(i, usage(db, i.school_id).get(i.id, 0))


@router.get("/stock/{item_id}/moves")
def moves(item_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    i = db.get(StockItem, item_id)
    if not i:
        raise not_found("Item")
    need_store(db, user, i.school_id, i.store)
    nm = Names(db, i.school_id)
    rows = db.scalars(select(StockMove).where(StockMove.item_id == item_id).order_by(StockMove.created_at.desc()).limit(100))
    return [{"id": str(m.id), "kind": m.kind, "quantity": m.quantity, "balance": m.balance, "unit_cost": m.unit_cost, "supplier": m.supplier,
             "issued_to": m.issued_to, "note": m.note, "by": nm.name(m.by_id), "at": m.created_at.isoformat()} for m in rows]


class IssueLine(BaseModel):
    item_id: uuid.UUID
    quantity: float = Field(gt=0, le=10_000_000)


class IssueIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    store: str = "main"
    lines: list[IssueLine] = Field(min_length=1, max_length=40)
    issued_to: str = Field(min_length=2, max_length=120)
    note: str | None = Field(default=None, max_length=200)
    ticket_id: uuid.UUID | None = None


@router.post("/schools/{school_id}/stock/issue")
def issue(school_id: uuid.UUID, data: IssueIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Give out several items at once, for example to answer a store request on the helpdesk."""
    need_store(db, user, school_id, data.store)
    t = db.get(Ticket, data.ticket_id) if data.ticket_id else None
    if data.ticket_id and (not t or t.school_id != school_id):
        raise not_found("Job")
    given = []
    for line in data.lines:
        i = db.get(StockItem, line.item_id)
        if not i or i.school_id != school_id or i.store != data.store or not i.active:
            raise not_found("Item")
        apply_move(db, i, MoveIn(kind="out", quantity=line.quantity, issued_to=data.issued_to, note=data.note, ticket_id=data.ticket_id), user)
        given.append(f"{units(line.quantity, i.unit)} {i.name}")
    if t and t.status not in ("done", "closed"):
        now = datetime.now(timezone.utc)
        t.status, t.done_at = "done", now
        t.assigned_to_id = t.assigned_to_id or user.id
        t.comments = [*t.comments, {"at": now.isoformat(), "by": str(user.id), "name": user.full_name, "text": "Issued from the store: " + ", ".join(given), "kind": "done"}]
    db.commit()
    return {"issued": given}


@router.get("/schools/{school_id}/stock/shopping")
def shopping(school_id: uuid.UUID, store: str = "main", user: User = Depends(current_user), db: Session = Depends(get_db)):
    """What to buy: anything low, or that will run out in the next 3 weeks at the current rate."""
    need_store(db, user, school_id, store)
    used = usage(db, school_id)
    rows = []
    for i in db.scalars(select(StockItem).where(StockItem.school_id == school_id, StockItem.store == store, StockItem.active.is_(True)).order_by(StockItem.name)):
        u = used.get(i.id, 0)
        need_for_month = u - i.quantity          # enough for the next 30 days
        top_up = i.reorder_level * 2 - i.quantity
        if i.quantity <= i.reorder_level or (u and i.quantity < u * 0.7):
            buy = max(need_for_month, top_up, 1)
            buy = float(int(buy + 0.999))
            rows.append({"id": str(i.id), "name": i.name, "category": CATEGORIES[store].get(i.category, i.category), "unit": i.unit, "have": i.quantity,
                         "used_30": u, "buy": buy, "unit_cost": i.unit_cost, "cost": round(buy * i.unit_cost, 2) if i.unit_cost else None})
    return {"store": store, "items": rows, "total": round(sum(r["cost"] or 0 for r in rows), 2), "priced": all(r["cost"] is not None for r in rows)}


# =====================================================================
# Transport
# =====================================================================

def school_vehicles(db: Session, school_id: uuid.UUID) -> list[Vehicle]:
    return list(db.scalars(select(Vehicle).join(Branch, Branch.id == Vehicle.branch_id).where(Branch.school_id == school_id).order_by(Vehicle.name)))


def get_vehicle(db: Session, user: User, vid: uuid.UUID) -> tuple[Vehicle, uuid.UUID]:
    v = db.get(Vehicle, vid)
    if not v:
        raise not_found("Vehicle")
    sid = db.get(Branch, v.branch_id).school_id
    need_desk(db, user, sid, "transport")
    return v, sid


def efficiency(fills: list[FuelLog]) -> list[float]:
    """km per litre between fills that have odometer readings, oldest first."""
    f = sorted([x for x in fills if x.odometer], key=lambda x: (x.on_date, x.odometer))
    out = []
    for a, b in zip(f, f[1:]):
        if b.odometer > a.odometer and b.litres > 0:
            out.append(round((b.odometer - a.odometer) / b.litres, 2))
    return out


def vehicle_out(db: Session, v: Vehicle, school_id: uuid.UUID, today: date) -> dict:
    papers = {}
    for k, label in (("insurance_expiry", "Insurance"), ("roadworthiness_expiry", "Roadworthiness"), ("licence_expiry", "Vehicle licence")):
        d = getattr(v, k)
        papers[k] = {"label": label, "date": d.isoformat() if d else None, "days": (d - today).days if d else None}
    check = db.scalar(select(VehicleCheck).where(VehicleCheck.vehicle_id == v.id, VehicleCheck.on_date == today))
    fills = list(db.scalars(select(FuelLog).where(FuelLog.vehicle_id == v.id, FuelLog.on_date >= today - timedelta(days=120)).order_by(FuelLog.on_date)))
    eff = efficiency(fills)
    month = today.replace(day=1)
    fuel_m = sum(f.cost for f in fills if f.on_date >= month)
    serv_m = sum(s.cost or 0 for s in db.scalars(select(VehicleService).where(VehicleService.vehicle_id == v.id, VehicleService.on_date >= month)))
    open_trip = db.scalar(select(Trip).where(Trip.vehicle_id == v.id, Trip.ended_at.is_(None)).order_by(Trip.started_at.desc()))
    since_service = (v.odometer_km - v.last_service_km) if v.odometer_km is not None and v.last_service_km is not None else None
    return {"id": str(v.id), "name": v.name, "kind": v.kind.value, "plate_number": v.plate_number, "capacity": v.capacity,
            "driver_name": v.driver_name, "driver_phone": v.driver_phone, "odometer_km": v.odometer_km, "papers": papers,
            "service_every_km": v.service_every_km, "last_service_km": v.last_service_km, "since_service_km": since_service,
            "service_due": bool(since_service is not None and v.service_every_km and since_service >= v.service_every_km * 0.9),
            "check": {"all_ok": check.all_ok, "items": check.items, "notes": check.notes} if check else None,
            "efficiency": eff[-6:], "efficiency_avg": round(mean(eff[:-1]), 2) if len(eff) > 1 else None,
            "fuel_month": fuel_m, "service_month": serv_m,
            "open_trip": {"id": str(open_trip.id), "purpose": open_trip.purpose, "destination": open_trip.destination,
                          "started_at": open_trip.started_at.isoformat()} if open_trip else None}


@router.get("/schools/{school_id}/fleet")
def fleet(school_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    need_desk(db, user, school_id, "transport")
    today = now_wat().date()
    vs = [vehicle_out(db, v, school_id, today) for v in school_vehicles(db, school_id)]
    tips = []
    for v in vs:
        for p in v["papers"].values():
            if p["days"] is not None and p["days"] < 0:
                tips.append({"kind": "alert", "icon": "calendar-x", "text": f"{v['name']}: {p['label'].lower()} expired {-p['days']} days ago. Don't use it on the road until renewed."})
            elif p["days"] is not None and p["days"] <= 30:
                tips.append({"kind": "tip", "icon": "calendar-days", "text": f"{v['name']}: {p['label'].lower()} expires in {p['days']} days."})
        if v["service_due"]:
            tips.append({"kind": "tip", "icon": "wrench", "text": f"{v['name']} is due a service: {v['since_service_km']:,} km since the last one (every {v['service_every_km']:,} km)."})
        if v["efficiency_avg"] and v["efficiency"] and v["efficiency"][-1] < v["efficiency_avg"] * 0.8:
            tips.append({"kind": "alert", "icon": "flame", "text": f"{v['name']} did {v['efficiency'][-1]} km per litre on the last tank, against {v['efficiency_avg']} usually. "
                         "Check for a fuel leak, a fault, or fuel not going into the vehicle."})
        if v["check"] and not v["check"]["all_ok"]:
            bad = [CHECK_ITEMS.get(k, k) for k, ok in v["check"]["items"].items() if not ok]
            tips.append({"kind": "alert", "icon": "shield", "text": f"{v['name']} failed today's check: {', '.join(bad).lower()}. A job has gone to the transport team."})
    if now_wat().weekday() < 5 and now_wat().hour >= 7:
        unchecked = [v["name"] for v in vs if not v["check"]]
        if unchecked:
            tips.append({"kind": "tip", "icon": "clipboard", "text": "Not checked yet today: " + ", ".join(unchecked) + "."})
    tips += [t for t in bus_alerts(db, school_id)]
    return {"vehicles": vs, "check_items": CHECK_ITEMS, "insights": tips}


class PapersIn(BaseModel):
    odometer_km: int | None = Field(default=None, ge=0, le=5_000_000)
    insurance_expiry: date | None = None
    roadworthiness_expiry: date | None = None
    licence_expiry: date | None = None
    service_every_km: int | None = Field(default=None, ge=500, le=100_000)
    last_service_km: int | None = Field(default=None, ge=0, le=5_000_000)


@router.put("/vehicles/{vid}/papers")
def set_papers(vid: uuid.UUID, data: PapersIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    v, sid = get_vehicle(db, user, vid)
    for k, val in data.model_dump().items():
        setattr(v, k, val)
    db.commit()
    return vehicle_out(db, v, sid, now_wat().date())


def bump_odometer(v: Vehicle, km: int | None) -> None:
    if km is not None and (v.odometer_km is None or km > v.odometer_km):
        v.odometer_km = km


class CheckIn(BaseModel):
    items: dict[str, bool]
    odometer: int | None = Field(default=None, ge=0, le=5_000_000)
    notes: str | None = Field(default=None, max_length=300)


@router.post("/vehicles/{vid}/checks")
def daily_check(vid: uuid.UUID, data: CheckIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    v, sid = get_vehicle(db, user, vid)
    if set(data.items) - set(CHECK_ITEMS):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Unknown check item")
    today = now_wat().date()
    c = db.scalar(select(VehicleCheck).where(VehicleCheck.vehicle_id == v.id, VehicleCheck.on_date == today))
    if not c:
        c = VehicleCheck(school_id=sid, vehicle_id=v.id, on_date=today)
        db.add(c)
    c.items, c.odometer, c.notes, c.by_id = data.items, data.odometer, data.notes, user.id
    c.all_ok = all(data.items.get(k, False) for k in CHECK_ITEMS)
    bump_odometer(v, data.odometer)
    if not c.all_ok and not c.ticket_id:
        bad = [CHECK_ITEMS[k] for k in CHECK_ITEMS if not data.items.get(k, False)]
        n = (db.scalar(select(func.max(Ticket.number)).where(Ticket.school_id == sid)) or 0) + 1
        t = Ticket(school_id=sid, number=n, desk="transport", category="transport", title=f"{v.name}: daily check problems ({', '.join(bad).lower()})",
                   details=data.notes, location=v.plate_number or v.name, priority="urgent" if {"Brakes", "Tyres", "Lights and indicators"} & set(bad) else "normal",
                   status="new", raised_by_id=user.id, due_on=today + timedelta(days=1), comments=[])
        db.add(t)
        db.flush()
        c.ticket_id = t.id
    db.commit()
    return vehicle_out(db, v, sid, today)


class TripIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    kind: str = "errand"
    purpose: str = Field(min_length=2, max_length=200)
    destination: str | None = Field(default=None, max_length=120)
    passengers: int | None = Field(default=None, ge=0, le=200)
    odometer_start: int | None = Field(default=None, ge=0, le=5_000_000)


@router.post("/vehicles/{vid}/trips", status_code=201)
def start_trip(vid: uuid.UUID, data: TripIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    v, sid = get_vehicle(db, user, vid)
    if data.kind not in TRIP_KINDS:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Choose the kind of trip")
    if db.scalar(select(Trip.id).where(Trip.vehicle_id == v.id, Trip.ended_at.is_(None))):
        raise HTTPException(status.HTTP_409_CONFLICT, f"{v.name} is already out. End that trip first.")
    t = Trip(school_id=sid, vehicle_id=v.id, driver_id=user.id, started_at=datetime.now(timezone.utc), **data.model_dump())
    bump_odometer(v, data.odometer_start)
    db.add(t)
    db.commit()
    return vehicle_out(db, v, sid, now_wat().date())


class TripEnd(BaseModel):
    odometer_end: int | None = Field(default=None, ge=0, le=5_000_000)
    notes: str | None = Field(default=None, max_length=300)


@router.put("/trips/{tid}/end")
def end_trip(tid: uuid.UUID, data: TripEnd, user: User = Depends(current_user), db: Session = Depends(get_db)):
    t = db.get(Trip, tid)
    if not t:
        raise not_found("Trip")
    v, sid = get_vehicle(db, user, t.vehicle_id)
    if t.ended_at:
        raise HTTPException(status.HTTP_409_CONFLICT, "This trip has ended")
    if data.odometer_end is not None and t.odometer_start is not None and data.odometer_end < t.odometer_start:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "The end reading is lower than the start reading")
    t.ended_at, t.odometer_end, t.notes = datetime.now(timezone.utc), data.odometer_end, data.notes or t.notes
    bump_odometer(v, data.odometer_end)
    db.commit()
    return vehicle_out(db, v, sid, now_wat().date())


class FuelIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    on_date: date
    litres: float = Field(gt=0, le=2000)
    cost: float = Field(ge=0, le=100_000_000)
    odometer: int | None = Field(default=None, ge=0, le=5_000_000)
    station: str | None = Field(default=None, max_length=80)


@router.post("/vehicles/{vid}/fuel", status_code=201)
def add_fuel(vid: uuid.UUID, data: FuelIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    v, sid = get_vehicle(db, user, vid)
    db.add(FuelLog(school_id=sid, vehicle_id=v.id, by_id=user.id, **data.model_dump()))
    bump_odometer(v, data.odometer)
    db.commit()
    return vehicle_out(db, v, sid, now_wat().date())


class ServiceLogIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    on_date: date
    kind: str = "service"
    description: str = Field(min_length=2, max_length=200)
    cost: float | None = Field(default=None, ge=0, le=100_000_000)
    odometer: int | None = Field(default=None, ge=0, le=5_000_000)
    garage: str | None = Field(default=None, max_length=120)


@router.post("/vehicles/{vid}/services", status_code=201)
def add_service(vid: uuid.UUID, data: ServiceLogIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    v, sid = get_vehicle(db, user, vid)
    if data.kind not in SERVICE_KINDS:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Choose the kind of work")
    db.add(VehicleService(school_id=sid, vehicle_id=v.id, by_id=user.id, **data.model_dump()))
    bump_odometer(v, data.odometer)
    if data.kind == "service" and data.odometer is not None:
        v.last_service_km = data.odometer
    db.commit()
    return vehicle_out(db, v, sid, now_wat().date())


@router.get("/vehicles/{vid}/history")
def vehicle_history(vid: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    v, sid = get_vehicle(db, user, vid)
    nm = Names(db, sid)
    since = now_wat().date() - timedelta(days=90)
    ev = []
    for t in db.scalars(select(Trip).where(Trip.vehicle_id == v.id, Trip.started_at >= datetime.combine(since, time(0), WAT))):
        km = (t.odometer_end - t.odometer_start) if t.odometer_end is not None and t.odometer_start is not None else None
        ev.append({"at": t.started_at.isoformat(), "kind": "trip", "title": f"{TRIP_KINDS.get(t.kind, t.kind)}: {t.purpose}",
                   "detail": " · ".join(x for x in [t.destination, f"{km} km" if km is not None else None, nm.name(t.driver_id), "still out" if not t.ended_at else None] if x)})
    for f in db.scalars(select(FuelLog).where(FuelLog.vehicle_id == v.id, FuelLog.on_date >= since)):
        ev.append({"at": datetime.combine(f.on_date, time(12), WAT).isoformat(), "kind": "fuel", "title": f"Fuel: {f.litres:g} litres",
                   "detail": " · ".join(x for x in [f"₦{f.cost:,.0f}", f"{f.odometer:,} km" if f.odometer else None, f.station] if x)})
    for s in db.scalars(select(VehicleService).where(VehicleService.vehicle_id == v.id, VehicleService.on_date >= since - timedelta(days=275))):
        ev.append({"at": datetime.combine(s.on_date, time(12), WAT).isoformat(), "kind": "service", "title": f"{SERVICE_KINDS.get(s.kind, s.kind)}: {s.description}",
                   "detail": " · ".join(x for x in [f"₦{s.cost:,.0f}" if s.cost else None, s.garage, f"{s.odometer:,} km" if s.odometer else None] if x)})
    for c in db.scalars(select(VehicleCheck).where(VehicleCheck.vehicle_id == v.id, VehicleCheck.on_date >= since)):
        bad = [CHECK_ITEMS.get(k, k) for k, ok in c.items.items() if not ok]
        ev.append({"at": datetime.combine(c.on_date, time(6), WAT).isoformat(), "kind": "check", "title": "Daily check: all OK" if c.all_ok else "Daily check: problems",
                   "detail": ", ".join(bad) if bad else nm.name(c.by_id)})
    ev.sort(key=lambda x: x["at"], reverse=True)
    return {"vehicle": vehicle_out(db, v, sid, now_wat().date()), "events": ev[:120]}


# ---------- Bus routes and the bus register ----------

class Stop(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    morning: str | None = Field(default=None, max_length=5)
    afternoon: str | None = Field(default=None, max_length=5)


class RouteIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    name: str = Field(min_length=2, max_length=80)
    vehicle_id: uuid.UUID | None = None
    stops: list[Stop] = Field(default=[], max_length=40)
    driver_id: uuid.UUID | None = None
    attendant_id: uuid.UUID | None = None


def route_out(db: Session, r: BusRoute, nm: Names, today: date) -> dict:
    riders = [(rr, db.get(Student, rr.student_id)) for rr in db.scalars(select(RouteRider).where(RouteRider.route_id == r.id))]
    regs = {g.run: g for g in db.scalars(select(BusRegister).where(BusRegister.route_id == r.id, BusRegister.on_date == today))}
    v = db.get(Vehicle, r.vehicle_id) if r.vehicle_id else None
    return {"id": str(r.id), "name": r.name, "vehicle_id": str(r.vehicle_id) if r.vehicle_id else None, "vehicle_name": v.name if v else None,
            "stops": r.stops, "driver": nm.card(r.driver_id), "attendant": nm.card(r.attendant_id),
            "riders": sorted([{**student_card(db, s), "stop": rr.stop} for rr, s in riders if s], key=lambda x: (x["stop"] or "", x["name"])),
            "today": {run: {"boarded": len(g.boarded), "all_off": bool(g.all_off_at), "started_at": g.started_at.isoformat() if g.started_at else None}
                      for run, g in regs.items()}}


@router.get("/schools/{school_id}/routes")
def routes(school_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    need_desk(db, user, school_id, "transport")
    nm = Names(db, school_id)
    today = now_wat().date()
    return [route_out(db, r, nm, today) for r in db.scalars(select(BusRoute).where(BusRoute.school_id == school_id).order_by(BusRoute.name))]


def check_route_people(db: Session, school_id: uuid.UUID, data: RouteIn) -> None:
    ids = staff_ids(db, school_id)
    for x in (data.driver_id, data.attendant_id):
        if x and x not in ids:
            raise not_found("Staff member")
    if data.vehicle_id and data.vehicle_id not in {v.id for v in school_vehicles(db, school_id)}:
        raise not_found("Vehicle")


@router.post("/schools/{school_id}/routes", status_code=201)
def add_route(school_id: uuid.UUID, data: RouteIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    need_desk(db, user, school_id, "transport")
    check_route_people(db, school_id, data)
    r = BusRoute(school_id=school_id, **data.model_dump(exclude={"stops"}), stops=[s.model_dump() for s in data.stops])
    db.add(r)
    db.commit()
    return route_out(db, r, Names(db, school_id), now_wat().date())


@router.put("/routes/{rid}")
def edit_route(rid: uuid.UUID, data: RouteIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    r = db.get(BusRoute, rid)
    if not r:
        raise not_found("Route")
    need_desk(db, user, r.school_id, "transport")
    check_route_people(db, r.school_id, data)
    for k, v in data.model_dump(exclude={"stops"}).items():
        setattr(r, k, v)
    r.stops = [s.model_dump() for s in data.stops]
    db.commit()
    return route_out(db, r, Names(db, r.school_id), now_wat().date())


@router.delete("/routes/{rid}", status_code=204)
def delete_route(rid: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    r = db.get(BusRoute, rid)
    if not r:
        raise not_found("Route")
    need_desk(db, user, r.school_id, "transport")
    db.delete(r)
    db.commit()
    return Response(status_code=204)


class Rider(BaseModel):
    student_id: uuid.UUID
    stop: str | None = Field(default=None, max_length=80)


class RidersIn(BaseModel):
    riders: list[Rider] = Field(max_length=200)


@router.put("/routes/{rid}/riders")
def set_riders(rid: uuid.UUID, data: RidersIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    r = db.get(BusRoute, rid)
    if not r:
        raise not_found("Route")
    need_desk(db, user, r.school_id, "transport")
    for x in data.riders:
        s = db.get(Student, x.student_id)
        if not s or s.school_id != r.school_id:
            raise not_found("Student")
    for rr in db.scalars(select(RouteRider).where(RouteRider.route_id == r.id)):
        db.delete(rr)
    db.flush()
    seen = set()
    for x in data.riders:
        if x.student_id not in seen:
            db.add(RouteRider(route_id=r.id, student_id=x.student_id, stop=x.stop))
            seen.add(x.student_id)
    db.commit()
    return route_out(db, r, Names(db, r.school_id), now_wat().date())


@router.get("/routes/{rid}/register")
def get_register(rid: uuid.UUID, run: str = Query(pattern="^(morning|afternoon)$"), on: date | None = Query(None, alias="date"),
                 user: User = Depends(current_user), db: Session = Depends(get_db)):
    r = db.get(BusRoute, rid)
    if not r:
        raise not_found("Route")
    need_desk(db, user, r.school_id, "transport")
    day = on or now_wat().date()
    g = db.scalar(select(BusRegister).where(BusRegister.route_id == r.id, BusRegister.on_date == day, BusRegister.run == run))
    route = route_out(db, r, Names(db, r.school_id), day)
    return {"route": route, "date": day.isoformat(), "run": run, "boarded": g.boarded if g else [], "started_at": g.started_at.isoformat() if g and g.started_at else None,
            "all_off_at": g.all_off_at.isoformat() if g and g.all_off_at else None, "notes": g.notes if g else None}


class RegisterIn(BaseModel):
    run: str = Field(pattern="^(morning|afternoon)$")
    boarded: list[uuid.UUID] = Field(max_length=200)
    all_off: bool = False
    notes: str | None = Field(default=None, max_length=1000)


@router.put("/routes/{rid}/register")
def save_register(rid: uuid.UUID, data: RegisterIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    r = db.get(BusRoute, rid)
    if not r:
        raise not_found("Route")
    need_desk(db, user, r.school_id, "transport")
    riders = set(db.scalars(select(RouteRider.student_id).where(RouteRider.route_id == r.id)))
    if not set(data.boarded) <= riders:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Only students on this route can be ticked")
    day = now_wat().date()
    g = db.scalar(select(BusRegister).where(BusRegister.route_id == r.id, BusRegister.on_date == day, BusRegister.run == data.run))
    if not g:
        g = BusRegister(school_id=r.school_id, route_id=r.id, on_date=day, run=data.run, started_at=datetime.now(timezone.utc))
        db.add(g)
    g.boarded, g.notes, g.by_id = [str(x) for x in data.boarded], data.notes, user.id
    if data.all_off and not g.all_off_at:
        g.all_off_at = datetime.now(timezone.utc)
    if not data.all_off:
        g.all_off_at = None
    db.commit()
    return get_register(rid, data.run, None, user, db)


def bus_alerts(db: Session, school_id: uuid.UUID) -> list[dict]:
    """A bus run that started more than 90 minutes ago and nobody has confirmed the bus is empty."""
    now = datetime.now(timezone.utc)
    rows = db.scalars(select(BusRegister).where(BusRegister.school_id == school_id, BusRegister.on_date == now_wat().date(),
                                                BusRegister.all_off_at.is_(None), BusRegister.started_at <= now - timedelta(minutes=90)))
    out = []
    for g in rows:
        if g.boarded:
            r = db.get(BusRoute, g.route_id)
            out.append({"kind": "alert", "icon": "bus", "text": f"{r.name} {g.run} run: {len(g.boarded)} children got on, but nobody has confirmed the bus is empty. Check the bus now."})
    return out


# ---------- Summary for the principal's operations overview ----------

@router.get("/schools/{school_id}/logistics/overview")
def logistics_overview(school_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    school_for(db, user, school_id, manage=True)
    k = kitchen_day(school_id, None, user, db)
    main = list_stock(school_id, "main", user, db)
    food = list_stock(school_id, "kitchen", user, db)
    fl = fleet(school_id, user, db)
    return {"meals": [{"label": m["label"], "expected": m["expected"], "dishes": m["dishes"]} for m in k["meals"]], "diets": len(k["diets"]),
            "store": {"items": len(main["items"]), "low": sum(1 for i in main["items"] if i["status"] != "ok"), "value": main["value"]},
            "food": {"items": len(food["items"]), "low": sum(1 for i in food["items"] if i["status"] != "ok"), "value": food["value"]},
            "fleet": {"vehicles": len(fl["vehicles"]), "checked": sum(1 for v in fl["vehicles"] if v["check"]),
                      "out": sum(1 for v in fl["vehicles"] if v["open_trip"]), "fuel_month": sum(v["fuel_month"] for v in fl["vehicles"])},
            "insights": k["insights"] + main["insights"] + food["insights"] + fl["insights"]}
