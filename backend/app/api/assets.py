"""The asset register: every valuable thing with its own tag and QR label, where it is, who has it,
what it is worth now, its repairs, and stock-takes that show what is missing."""
import re
import uuid
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.access import not_found
from app.api.deps import current_user
from app.api.ops import Names
from app.api.staff_day import now_wat, runs, school_for, staff_ids
from app.core import rights
from app.core.db import get_db
from app.models import Asset, AssetCount, Branch, Facility, School, Ticket, User

router = APIRouter(prefix="/api", tags=["assets"])

CATEGORIES = {
    "furniture": {"label": "Furniture", "code": "FUR", "icon": "armchair", "life": 10},
    "ict": {"label": "Computers and ICT", "code": "ICT", "icon": "laptop", "life": 4},
    "lab": {"label": "Laboratory equipment", "code": "LAB", "icon": "flask", "life": 8},
    "kitchen": {"label": "Kitchen equipment", "code": "KIT", "icon": "cooking-pot", "life": 7},
    "electrical": {"label": "Electrical and power", "code": "ELE", "icon": "zap", "life": 8},
    "sports": {"label": "Sports equipment", "code": "SPT", "icon": "trophy", "life": 5},
    "office": {"label": "Office equipment", "code": "OFF", "icon": "printer", "life": 5},
    "music": {"label": "Music and drama", "code": "MUS", "icon": "music", "life": 10},
    "other": {"label": "Other", "code": "OTH", "icon": "shapes", "life": 5},
}
CONDITIONS = {"new": "New", "good": "Good", "fair": "Fair", "poor": "Poor", "broken": "Broken"}
STATUSES = {"in_use": "In use", "in_store": "In store", "repair": "Being repaired", "lost": "Missing", "disposed": "Disposed of"}


@router.get("/assets/meta")
def meta(user: User = Depends(current_user)):
    return {"categories": CATEGORIES, "conditions": CONDITIONS, "statuses": STATUSES}


def need(db: Session, user: User, school_id: uuid.UUID, level: str | None = None) -> School:
    s = school_for(db, user, school_id)
    if not runs(user, s, "facilities", level):
        from app.api.access import check
        check(user, s, "facilities")
        raise not_found("School")
    return s


def prefix(school: School) -> str:
    words = [w for w in re.findall(r"[A-Za-z]+", school.name) if w.lower() not in ("the", "of", "and")]
    return "".join(w[0] for w in words[:3]).upper() or "SCH"


def book_value(a: Asset, on: date) -> float | None:
    if a.cost is None:
        return None
    if not a.purchase_date or not a.life_years:
        return round(a.cost, 2)
    used = (on - a.purchase_date).days / 365.25
    return round(max(0.0, a.cost * (1 - used / a.life_years)), 2)


def end_of_life(a: Asset) -> date | None:
    if not a.purchase_date or not a.life_years:
        return None
    try:
        return a.purchase_date.replace(year=a.purchase_date.year + a.life_years)
    except ValueError:
        return a.purchase_date + timedelta(days=365 * a.life_years)


def facilities_of(db: Session, school_id: uuid.UUID) -> dict:
    return {f.id: f for f in db.scalars(select(Facility).join(Branch, Branch.id == Facility.branch_id).where(Branch.school_id == school_id))}


def asset_out(a: Asset, facs: dict, nm: Names, today: date, repairs: dict | None = None) -> dict:
    f = facs.get(a.facility_id)
    c = CATEGORIES.get(a.category, CATEGORIES["other"])
    r = (repairs or {}).get(a.id, {"count": 0, "cost": 0.0})
    eol = end_of_life(a)
    return {"id": str(a.id), "tag": a.tag, "code": f"SP1:A:{a.tag}", "name": a.name, "category": a.category, "category_label": c["label"], "icon": c["icon"],
            "make_model": a.make_model, "serial_no": a.serial_no, "facility_id": str(a.facility_id) if a.facility_id else None,
            "place": f.name if f else a.location, "location": a.location, "assigned_to_id": str(a.assigned_to_id) if a.assigned_to_id else None,
            "assigned_to": nm.name(a.assigned_to_id), "supplier": a.supplier, "purchase_date": a.purchase_date.isoformat() if a.purchase_date else None,
            "cost": a.cost, "life_years": a.life_years, "value": book_value(a, today), "end_of_life": eol.isoformat() if eol else None,
            "warranty_until": a.warranty_until.isoformat() if a.warranty_until else None,
            "warranty_days": (a.warranty_until - today).days if a.warranty_until else None,
            "condition": a.condition, "status": a.status, "status_label": STATUSES.get(a.status, a.status), "photo": a.photo, "notes": a.notes,
            "last_seen_at": a.last_seen_at.isoformat() if a.last_seen_at else None, "repairs": r["count"], "repair_cost": r["cost"]}


def repair_counts(db: Session, school_id: uuid.UUID) -> dict:
    out = defaultdict(lambda: {"count": 0, "cost": 0.0})
    since = datetime.now(timezone.utc) - timedelta(days=365)
    for t in db.scalars(select(Ticket).where(Ticket.school_id == school_id, Ticket.asset_id.is_not(None), Ticket.created_at >= since)):
        out[t.asset_id]["count"] += 1
        out[t.asset_id]["cost"] += t.cost or 0
    return out


@router.get("/schools/{school_id}/assets")
def list_assets(school_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    need(db, user, school_id)
    today = now_wat().date()
    facs = facilities_of(db, school_id)
    nm = Names(db, school_id)
    rep = repair_counts(db, school_id)
    rows = list(db.scalars(select(Asset).where(Asset.school_id == school_id).order_by(Asset.category, Asset.tag)))
    items = [asset_out(a, facs, nm, today, rep) for a in rows]
    live = [i for i in items if i["status"] not in ("disposed",)]
    return {"assets": items, "totals": {"count": len(live), "cost": sum(i["cost"] or 0 for i in live), "value": sum(i["value"] or 0 for i in live),
                                        "missing": sum(1 for i in live if i["status"] == "lost"), "repair": sum(1 for i in live if i["status"] == "repair"),
                                        "poor": sum(1 for i in live if i["condition"] in ("poor", "broken"))},
            "by_place": sorted([{"place": p or "No place", "count": n} for p, n in Counter(i["place"] for i in live).items()], key=lambda x: -x["count"]),
            "insights": insights(rows, items, today), "prefix": prefix(db.get(School, school_id)),
            "facilities": [{"id": str(f.id), "name": f.name} for f in sorted(facs.values(), key=lambda f: f.name)]}


def insights(rows: list[Asset], items: list[dict], today: date) -> list[dict]:
    tips: list[dict] = []
    live = [i for i in items if i["status"] != "disposed"]
    naira = lambda n: f"₦{round(n):,}"
    missing = [i for i in live if i["status"] == "lost"]
    if missing:
        tips.append({"kind": "alert", "icon": "search", "text": f"{len(missing)} item{'s are' if len(missing) > 1 else ' is'} missing, worth about {naira(sum(i['value'] or i['cost'] or 0 for i in missing))}: "
                     + ", ".join(f"{i['name']} ({i['tag']})" for i in missing[:3]) + "."})
    soon = [i for i in live if i["warranty_days"] is not None and 0 <= i["warranty_days"] <= 60]
    if soon:
        tips.append({"kind": "tip", "icon": "calendar", "text": "Warranty ending within 60 days: " + ", ".join(f"{i['name']} ({i['warranty_days']} days)" for i in soon[:3]) + ". Report any faults before then."})
    costly = sorted([i for i in live if i["repairs"] >= 3], key=lambda i: -i["repair_cost"])
    for i in costly[:2]:
        extra = f", costing {naira(i['repair_cost'])}" if i["repair_cost"] else ""
        worth = f" It is worth about {naira(i['value'])} now." if i["value"] is not None else ""
        tips.append({"kind": "grow", "icon": "wrench", "text": f"{i['name']} ({i['tag']}) was repaired {i['repairs']} times this year{extra}.{worth} Replacing it may cost less."})
    year = today + timedelta(days=365)
    ending = [i for i in live if i["end_of_life"] and today <= date.fromisoformat(i["end_of_life"]) <= year and i["cost"]]
    if ending:
        tips.append({"kind": "tip", "icon": "coins", "text": f"{len(ending)} item{'s reach' if len(ending) > 1 else ' reaches'} the end of {'their' if len(ending) > 1 else 'its'} useful life in the next 12 months. "
                     f"Budget about {naira(sum(i['cost'] for i in ending))} to replace them."})
    nowhere = [i for i in live if not i["place"] and not i["assigned_to"]]
    if nowhere:
        tips.append({"kind": "tip", "icon": "place", "text": f"{len(nowhere)} item{'s have' if len(nowhere) > 1 else ' has'} no place or person. Add where they are, so a stock-take can find them."})
    broken = [i for i in live if i["condition"] == "broken" and i["status"] not in ("repair", "lost")]
    if broken:
        tips.append({"kind": "alert", "icon": "circle-x", "text": f"{len(broken)} broken item{'s are' if len(broken) > 1 else ' is'} not being repaired. Report a fault or dispose of {'them' if len(broken) > 1 else 'it'}."})
    unseen = [i for i in live if i["last_seen_at"] and (datetime.now(timezone.utc) - datetime.fromisoformat(i["last_seen_at"])).days > 365]
    never = [i for i in live if not i["last_seen_at"]]
    if len(live) >= 10 and (unseen or len(never) > len(live) / 2):
        tips.append({"kind": "tip", "icon": "scan-qr", "text": "Most items haven't been checked in a stock-take for a year. Start one this term: print the labels, then walk round and scan."})
    return tips


class AssetIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    name: str = Field(min_length=2, max_length=150)
    category: str = "other"
    make_model: str | None = Field(default=None, max_length=120)
    serial_no: str | None = Field(default=None, max_length=80)
    facility_id: uuid.UUID | None = None
    location: str | None = Field(default=None, max_length=120)
    assigned_to_id: uuid.UUID | None = None
    supplier: str | None = Field(default=None, max_length=120)
    purchase_date: date | None = None
    cost: float | None = Field(default=None, ge=0)
    life_years: int | None = Field(default=None, ge=1, le=60)
    warranty_until: date | None = None
    condition: str = Field(default="good", pattern="^(new|good|fair|poor|broken)$")
    status: str = Field(default="in_use", pattern="^(in_use|in_store|repair|lost|disposed)$")
    photo: str | None = Field(default=None, max_length=400_000)
    notes: str | None = Field(default=None, max_length=500)
    quantity: int = Field(default=1, ge=1, le=300)


def check_refs(db: Session, school_id: uuid.UUID, data: AssetIn) -> None:
    if data.category not in CATEGORIES:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Choose a category")
    if data.facility_id and data.facility_id not in facilities_of(db, school_id):
        raise not_found("Place")
    if data.assigned_to_id and data.assigned_to_id not in staff_ids(db, school_id):
        raise not_found("Staff member")


def next_tags(db: Session, school: School, category: str, n: int) -> list[str]:
    head = f"{prefix(school)}-{CATEGORIES[category]['code']}-"
    used = [int(t.rsplit("-", 1)[1]) for t in db.scalars(select(Asset.tag).where(Asset.school_id == school.id, Asset.tag.like(head + "%")))
            if t.rsplit("-", 1)[1].isdigit()]
    start = max(used, default=0) + 1
    return [f"{head}{i:04d}" for i in range(start, start + n)]


def note(a: Asset, user: User, text: str) -> None:
    a.history = [*(a.history or []), {"at": datetime.now(timezone.utc).isoformat(), "by": user.full_name, "text": text}][-60:]


@router.post("/schools/{school_id}/assets", status_code=201)
def add_assets(school_id: uuid.UUID, data: AssetIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    school = need(db, user, school_id)
    check_refs(db, school_id, data)
    body = data.model_dump(exclude={"quantity"})
    if body["life_years"] is None:
        body["life_years"] = CATEGORIES[data.category]["life"]
    tags = next_tags(db, school, data.category, data.quantity)
    for t in tags:
        a = Asset(school_id=school_id, tag=t, history=[], **body)
        note(a, user, "Added to the register")
        db.add(a)
    db.commit()
    return {"tags": tags, **list_assets(school_id, user, db)}


def get_asset(db: Session, user: User, asset_id: uuid.UUID) -> Asset:
    a = db.get(Asset, asset_id)
    if not a:
        raise not_found("Asset")
    need(db, user, a.school_id)
    return a


@router.get("/assets/{asset_id}")
def one_asset(asset_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    a = get_asset(db, user, asset_id)
    nm = Names(db, a.school_id)
    jobs = list(db.scalars(select(Ticket).where(Ticket.asset_id == a.id).order_by(Ticket.created_at.desc()).limit(50)))
    out = asset_out(a, facilities_of(db, a.school_id), nm, now_wat().date(), repair_counts(db, a.school_id))
    return {**out, "history": list(reversed(a.history or [])),
            "jobs": [{"number": t.number, "title": t.title, "status": t.status, "created_at": t.created_at.isoformat(), "cost": t.cost,
                      "fixed_by": nm.name(t.assigned_to_id)} for t in jobs]}


@router.put("/assets/{asset_id}")
def edit_asset(asset_id: uuid.UUID, data: AssetIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    a = get_asset(db, user, asset_id)
    check_refs(db, a.school_id, data)
    changes = []
    facs = facilities_of(db, a.school_id)
    nm = Names(db, a.school_id)
    for k, v in data.model_dump(exclude={"quantity"}).items():
        if getattr(a, k) != v:
            if k == "facility_id":
                changes.append(f"moved to {facs[v].name if v in facs else 'no place'}")
            elif k == "assigned_to_id":
                changes.append(f"given to {nm.name(v) if v else 'nobody'}")
            elif k in ("status", "condition"):
                changes.append(f"{k} now {(STATUSES if k == 'status' else CONDITIONS).get(v, v).lower()}")
            setattr(a, k, v)
    if changes:
        note(a, user, "; ".join(changes).capitalize())
    db.commit()
    return one_asset(asset_id, user, db)


@router.delete("/assets/{asset_id}", status_code=204)
def delete_asset(asset_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    a = get_asset(db, user, asset_id)
    db.delete(a)
    db.commit()
    return Response(status_code=204)


class FaultIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    title: str = Field(min_length=3, max_length=200)
    details: str | None = Field(default=None, max_length=2000)
    priority: str = Field(default="normal", pattern="^(low|normal|urgent)$")


@router.post("/assets/{asset_id}/fault", status_code=201)
def report_fault(asset_id: uuid.UUID, data: FaultIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """A job for the right team, linked to this item, so its repair history and cost build up."""
    a = get_asset(db, user, asset_id)
    desk = "it" if a.category == "ict" else "maintenance"
    n = (db.scalar(select(func.max(Ticket.number)).where(Ticket.school_id == a.school_id)) or 0) + 1
    f = db.get(Facility, a.facility_id) if a.facility_id else None
    t = Ticket(school_id=a.school_id, number=n, desk=desk, category="ict" if desk == "it" else "repair", title=f"{a.name} ({a.tag}): {data.title}",
               details=data.details, location=f.name if f else a.location, facility_id=a.facility_id, asset_id=a.id, priority=data.priority,
               status="new", raised_by_id=user.id, due_on=now_wat().date() + timedelta(days=1 if data.priority == "urgent" else 3), comments=[])
    db.add(t)
    if a.status == "in_use":
        a.status = "repair"
    note(a, user, f"Fault reported (job #{n}): {data.title}")
    db.commit()
    return {"number": n, **one_asset(asset_id, user, db)}


@router.get("/schools/{school_id}/assets/find")
def find(school_id: uuid.UUID, code: str = Query(min_length=2, max_length=60), user: User = Depends(current_user), db: Session = Depends(get_db)):
    need(db, user, school_id)
    tag = code.strip().removeprefix("SP1:A:").upper()
    a = db.scalar(select(Asset).where(Asset.school_id == school_id, func.upper(Asset.tag) == tag))
    if not a:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"No item tagged {tag}")
    return one_asset(a.id, user, db)


# ---------- Stock-takes ----------

class CountIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    name: str = Field(min_length=2, max_length=120)
    facility_id: uuid.UUID | None = None


def count_out(db: Session, c: AssetCount, user: User) -> dict:
    facs = facilities_of(db, c.school_id)
    nm = Names(db, c.school_id)
    q = select(Asset).where(Asset.school_id == c.school_id, Asset.status.not_in(["disposed"]))
    if c.facility_id:
        q = q.where(Asset.facility_id == c.facility_id)
    today = now_wat().date()
    expected = [asset_out(a, facs, nm, today) for a in db.scalars(q.order_by(Asset.tag))]
    found = c.found or {}
    for e in expected:
        e["found"] = found.get(e["id"])
    extra = [k for k in found if k not in {e["id"] for e in expected}]
    return {"id": str(c.id), "name": c.name, "place": facs[c.facility_id].name if c.facility_id in facs else "Whole school",
            "facility_id": str(c.facility_id) if c.facility_id else None, "started_by": nm.name(c.started_by_id), "created_at": c.created_at.isoformat(),
            "closed_at": c.closed_at.isoformat() if c.closed_at else None, "expected": expected, "found": sum(1 for e in expected if e["found"]),
            "elsewhere": len(extra)}


@router.get("/schools/{school_id}/asset-counts")
def counts(school_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    need(db, user, school_id)
    rows = list(db.scalars(select(AssetCount).where(AssetCount.school_id == school_id).order_by(AssetCount.created_at.desc()).limit(20)))
    out = []
    for c in rows:
        d = count_out(db, c, user)
        out.append({k: d[k] for k in ("id", "name", "place", "started_by", "created_at", "closed_at", "found")} | {"expected": len(d["expected"])})
    return out


@router.post("/schools/{school_id}/asset-counts", status_code=201)
def start_count(school_id: uuid.UUID, data: CountIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    need(db, user, school_id)
    if data.facility_id and data.facility_id not in facilities_of(db, school_id):
        raise not_found("Place")
    c = AssetCount(school_id=school_id, name=data.name, facility_id=data.facility_id, started_by_id=user.id, found={})
    db.add(c)
    db.commit()
    return count_out(db, c, user)


def get_count(db: Session, user: User, cid: uuid.UUID) -> AssetCount:
    c = db.get(AssetCount, cid)
    if not c:
        raise not_found("Stock-take")
    need(db, user, c.school_id)
    return c


@router.get("/asset-counts/{count_id}")
def one_count(count_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return count_out(db, get_count(db, user, count_id), user)


class SeenIn(BaseModel):
    code: str = Field(min_length=2, max_length=60)
    condition: str | None = Field(default=None, pattern="^(new|good|fair|poor|broken)$")
    unfound: bool = False


@router.post("/asset-counts/{count_id}/seen")
def seen(count_id: uuid.UUID, data: SeenIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    c = get_count(db, user, count_id)
    if c.closed_at:
        raise HTTPException(status.HTTP_409_CONFLICT, "This stock-take is finished")
    tag = data.code.strip().removeprefix("SP1:A:").upper()
    a = db.scalar(select(Asset).where(Asset.school_id == c.school_id, func.upper(Asset.tag) == tag))
    if not a:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"No item tagged {tag}")
    found = dict(c.found or {})
    moved = None
    if data.unfound:
        found.pop(str(a.id), None)
    else:
        found[str(a.id)] = {"at": datetime.now(timezone.utc).isoformat(), "by": user.full_name, "condition": data.condition or a.condition}
        if c.facility_id and a.facility_id != c.facility_id:
            f = db.get(Facility, c.facility_id)
            moved = f"{a.name} was listed in {facilities_of(db, c.school_id).get(a.facility_id).name if a.facility_id in facilities_of(db, c.school_id) else 'another place'}; it is now marked as in {f.name if f else 'this place'}."
            note(a, user, f"Found in {f.name if f else 'another place'} during “{c.name}”")
            a.facility_id = c.facility_id
        if data.condition and data.condition != a.condition:
            note(a, user, f"Condition now {CONDITIONS[data.condition].lower()} (stock-take)")
            a.condition = data.condition
        if a.status == "lost":
            a.status = "in_use"
            note(a, user, "Found again")
    c.found = found
    db.commit()
    return {"asset": {"id": str(a.id), "tag": a.tag, "name": a.name}, "moved": moved, **count_out(db, c, user)}


class CloseIn(BaseModel):
    mark_missing: bool = True


@router.post("/asset-counts/{count_id}/close")
def close_count(count_id: uuid.UUID, data: CloseIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    c = get_count(db, user, count_id)
    if c.closed_at:
        raise HTTPException(status.HTTP_409_CONFLICT, "Already finished")
    out = count_out(db, c, user)
    missing = 0
    for e in out["expected"]:
        a = db.get(Asset, uuid.UUID(e["id"]))
        if e["found"]:
            a.last_seen_at = datetime.fromisoformat(e["found"]["at"])
        elif data.mark_missing and a.status not in ("lost", "repair"):
            a.status = "lost"
            note(a, user, f"Not found in “{c.name}”")
            missing += 1
    c.closed_at = datetime.now(timezone.utc)
    db.commit()
    return {"missing": missing, **count_out(db, c, user)}


@router.get("/schools/{school_id}/assets/labels")
def labels(school_id: uuid.UUID, ids: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    school = need(db, user, school_id)
    want = []
    for x in ids.split(","):
        try:
            want.append(uuid.UUID(x.strip()))
        except ValueError:
            continue
    rows = db.scalars(select(Asset).where(Asset.school_id == school_id, Asset.id.in_(want[:400] or [uuid.uuid4()])).order_by(Asset.tag))
    return {"school": school.name, "labels": [{"tag": a.tag, "code": f"SP1:A:{a.tag}", "name": a.name} for a in rows]}
