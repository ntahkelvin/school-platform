"""What a student can do in their own portal: library, reading, clubs, goals, badges, calendar, ID card and reporting a worry.

A student acts for themselves. A parent can look (read only) at the same things for their own child.
Worries reach only the people with the safeguarding right, never teachers in general or other students.
"""
import uuid
from collections import Counter
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.api.access import check, not_found
from app.api.deps import current_user
from app.api.family import child_for
from app.api.library import term_start
from app.api.staff_day import STAFF_ROLES, now_wat
from app.api.student360 import attendance_summary
from app.core import rights
from app.core.db import get_db
from app.models import (
    Book, BookCopy, BookHold, Club, ClubRequest, Concern, ConductEntry, House, Loan, Membership, Notice, ReadingEntry, School, SchoolClass,
    SchoolEvent, Student, StudentAward, StudentClub, StudentGoal, User,
)
from app.models.people import StudentStatus

router = APIRouter(prefix="/api", tags=["student portal"])

READING_TARGET = 10          # books a term
GOAL_AREAS = {"study": "Studies", "reading": "Reading", "sport": "Sport and health", "character": "Character", "skill": "A new skill", "other": "Something else"}
WORRY_KINDS = {"bullying": "Someone is bullying me or a friend", "unsafe": "I don't feel safe", "sad": "I feel sad, worried or alone",
               "online": "Something happened online", "health": "I am unwell or hurt", "other": "Something else"}


def who(db: Session, user: User, student_id: uuid.UUID | None) -> tuple[Student, str]:
    if student_id:
        return child_for(db, user, student_id)
    s = db.scalar(select(Student).where(Student.user_id == user.id))
    if not s:
        raise not_found("Student")
    return s, "self"


def own(db: Session, user: User) -> Student:
    s, how = who(db, user, None)
    if rights.acting(user):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Nothing can be changed while seeing as someone else")
    if s.status != StudentStatus.active:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Your school account is closed")
    return s


# ---------- Badges ----------

def badges(db: Session, s: Student) -> list[dict]:
    att = attendance_summary(db, s)
    pts = db.scalar(select(func.sum(ConductEntry.points)).where(ConductEntry.student_id == s.id, ConductEntry.points > 0)) or 0
    books = (db.scalar(select(func.count()).select_from(ReadingEntry).where(ReadingEntry.student_id == s.id)) or 0)
    loans = db.scalar(select(func.count()).select_from(Loan).where(Loan.student_id == s.id)) or 0
    awards = db.scalar(select(func.count()).select_from(StudentAward).where(StudentAward.student_id == s.id)) or 0
    clubs = db.scalar(select(func.count()).select_from(StudentClub).where(StudentClub.student_id == s.id)) or 0
    goals = db.scalar(select(func.count()).select_from(StudentGoal).where(StudentGoal.student_id == s.id, StudentGoal.status == "done")) or 0
    read = max(books, 0)
    rows = [
        ("streak", "flame", "orange", "On a roll", "days in school in a row", att["streak"], [5, 10, 20, 50]),
        ("present", "calendar-check", "green", "Always there", "attendance this month (%)", att["rate_30"] or 0, [90, 95, 100]),
        ("reader", "book", "sky", "Bookworm", "books read", read, [1, 3, 5, 10, 20]),
        ("borrower", "library", "teal", "Library regular", "library books borrowed", loans, [1, 5, 10, 25]),
        ("merits", "star", "amber", "Star", "merit points", int(pts), [10, 25, 50, 100]),
        ("awards", "trophy", "rose", "Award winner", "awards", awards, [1, 3, 5]),
        ("clubs", "club", "fuchsia", "Joiner", "clubs and teams", clubs, [1, 2, 3]),
        ("goals", "target", "violet", "Goal getter", "goals reached", goals, [1, 3, 5]),
    ]
    out = []
    for key, icon, hue, name, what, value, steps in rows:
        level = sum(1 for x in steps if value >= x)
        nxt = next((x for x in steps if value < x), None)
        out.append({"key": key, "icon": icon, "hue": hue, "name": name, "what": what, "value": value, "level": level, "levels": len(steps),
                    "next": nxt, "earned": level > 0, "progress": round(100 * value / nxt) if nxt else 100})
    return out


# ---------- The portal's extra parts in one go ----------

@router.get("/me/student/extras")
def extras(student_id: uuid.UUID | None = None, user: User = Depends(current_user), db: Session = Depends(get_db)):
    s, how = who(db, user, student_id)
    school = db.get(School, s.school_id)
    today = now_wat().date()
    events = [{"title": e.title, "category": e.category.value, "starts_on": e.starts_on.isoformat(), "ends_on": e.ends_on.isoformat() if e.ends_on else None,
               "description": e.description}
              for e in db.scalars(select(SchoolEvent).where(SchoolEvent.school_id == s.school_id, or_(SchoolEvent.branch_id.is_(None), SchoolEvent.branch_id == s.branch_id),
                                                            or_(SchoolEvent.ends_on >= today, SchoolEvent.starts_on >= today)).order_by(SchoolEvent.starts_on).limit(12))]
    since = term_start()
    reading = list(db.scalars(select(ReadingEntry).where(ReadingEntry.student_id == s.id).order_by(ReadingEntry.finished_on.desc())))
    term_books = sum(1 for r in reading if r.finished_on >= since)
    logged = {r.loan_id for r in reading if r.loan_id}
    to_rate = []
    for l, b in db.execute(select(Loan, Book).join(Book, Book.id == Loan.book_id).where(Loan.student_id == s.id, Loan.returned_at.is_not(None),
                                                                                      Loan.returned_at >= datetime.now(timezone.utc) - timedelta(days=60)).order_by(Loan.returned_at.desc())):
        if l.id not in logged and len(to_rate) < 4:
            to_rate.append({"loan_id": str(l.id), "title": b.title, "author": b.author})
    goals = list(db.scalars(select(StudentGoal).where(StudentGoal.student_id == s.id, StudentGoal.status != "dropped").order_by(StudentGoal.status, StudentGoal.created_at.desc())))
    worries = list(db.scalars(select(Concern).where(Concern.student_id == s.id).order_by(Concern.created_at.desc()).limit(10))) if how == "self" else []
    unread = list(db.scalars(select(Notice).where(Notice.user_id == user.id, Notice.read_at.is_(None)).order_by(Notice.created_at.desc()).limit(5)))
    return {
        "how": how,
        "card": {"name": s.full_name, "admission_no": s.admission_no, "class_name": s.school_class.name if s.school_class else None, "photo": s.photo,
                 "boarder": s.boarding_status.value == "boarder", "house": (db.get(House, s.house_id).name if s.house_id else None),
                 "house_colour": (db.get(House, s.house_id).colour if s.house_id else None),
                 "code": f"SP1:P:{school.id.hex[:8]}:{s.id.hex}", "school": {"name": school.name, "logo": school.logo, "colour": school.colour, "motto": school.motto, "phone": school.phone},
                 "session": f"{today.year}/{today.year + 1}" if today.month >= 9 else f"{today.year - 1}/{today.year}"},
        "events": events,
        "badges": badges(db, s),
        "reading": {"target": READING_TARGET, "this_term": term_books, "total": len(reading), "to_rate": to_rate,
                    "books": [{"id": str(r.id), "title": r.title, "author": r.author, "rating": r.rating, "review": r.review, "finished_on": r.finished_on.isoformat(),
                               "library": bool(r.loan_id)} for r in reading[:30]]},
        "goals": [goal_out(g) for g in goals],
        "goal_areas": GOAL_AREAS,
        "worries": [worry_out(c, for_student=True) for c in worries],
        "worry_kinds": WORRY_KINDS,
        "notices": [{"id": str(n.id), "text": n.text, "icon": n.icon, "at": n.created_at.isoformat(), "link": n.link} for n in unread],
        "greeting": greeting(s, today),
    }


def greeting(s: Student, today: date) -> str:
    h = now_wat().hour
    part = "Good morning" if h < 12 else "Good afternoon" if h < 17 else "Good evening"
    if s.date_of_birth and (s.date_of_birth.month, s.date_of_birth.day) == (today.month, today.day):
        return f"Happy birthday, {s.nickname or s.first_name}! 🎂"
    return f"{part}, {s.nickname or s.first_name}!"


# ---------- Library ----------

@router.get("/me/student/library")
def library(student_id: uuid.UUID | None = None, q: str = Query("", max_length=60), category: str = Query("", max_length=20),
            user: User = Depends(current_user), db: Session = Depends(get_db)):
    s, how = who(db, user, student_id)
    today = now_wat().date()
    loans = [{"id": str(l.id), "title": b.title, "author": b.author, "due_on": l.due_on.isoformat(), "late": max(0, (today - l.due_on).days),
              "days_left": (l.due_on - today).days}
             for l, b in db.execute(select(Loan, Book).join(Book, Book.id == Loan.book_id).where(Loan.student_id == s.id, Loan.returned_at.is_(None)).order_by(Loan.due_on))]
    holds = []
    for h, b in db.execute(select(BookHold, Book).join(Book, Book.id == BookHold.book_id).where(BookHold.student_id == s.id, BookHold.status == "waiting")):
        ahead = db.scalar(select(func.count()).select_from(BookHold).where(BookHold.book_id == h.book_id, BookHold.status == "waiting", BookHold.created_at < h.created_at)) or 0
        avail = db.scalar(select(func.count()).select_from(BookCopy).where(BookCopy.book_id == h.book_id, BookCopy.status == "available")) or 0
        holds.append({"id": str(h.id), "book_id": str(b.id), "title": b.title, "ahead": ahead, "ready": ahead == 0 and avail > 0})
    stmt = select(Book).where(Book.school_id == s.school_id)
    if q.strip():
        like = f"%{q.strip()}%"
        stmt = stmt.where(or_(Book.title.ilike(like), Book.author.ilike(like), Book.subject.ilike(like)))
    if category:
        stmt = stmt.where(Book.category == category)
    level = s.school_class.level if s.school_class else None
    books = list(db.scalars(stmt.order_by(Book.title).limit(60)))
    ids = [b.id for b in books] or [uuid.uuid4()]
    avail = dict(db.execute(select(BookCopy.book_id, func.count()).where(BookCopy.book_id.in_(ids), BookCopy.status == "available").group_by(BookCopy.book_id)).all())
    total = dict(db.execute(select(BookCopy.book_id, func.count()).where(BookCopy.book_id.in_(ids), BookCopy.status.in_(["available", "on_loan"])).group_by(BookCopy.book_id)).all())
    popular = Counter(db.scalars(select(Loan.book_id).where(Loan.school_id == s.school_id, Loan.issued_at >= datetime.now(timezone.utc) - timedelta(days=90))))
    held = {h["book_id"] for h in holds}
    rows = [{"id": str(b.id), "title": b.title, "author": b.author, "category": b.category, "subject": b.subject, "level": b.level, "shelf": b.shelf,
             "summary": b.summary, "colour": b.colour, "available": avail.get(b.id, 0), "copies": total.get(b.id, 0), "held": str(b.id) in held,
             "popular": popular.get(b.id, 0), "for_me": bool(level and b.level and level in b.level)} for b in books]
    if not q.strip() and not category:
        rows.sort(key=lambda r: (-r["for_me"], -r["popular"], r["title"]))
    return {"loans": loans, "holds": holds, "books": rows, "can_act": how == "self",
            "categories": {"textbook": "Textbooks", "literature": "Literature", "fiction": "Stories", "reference": "Reference", "religious": "Religious", "magazine": "Magazines", "other": "Other"}}


class HoldIn(BaseModel):
    book_id: uuid.UUID


@router.post("/me/student/library/holds", status_code=201)
def reserve(data: HoldIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    s = own(db, user)
    b = db.get(Book, data.book_id)
    if not b or b.school_id != s.school_id:
        raise not_found("Book")
    if db.scalar(select(BookHold.id).where(BookHold.book_id == b.id, BookHold.student_id == s.id, BookHold.status == "waiting")):
        raise HTTPException(status.HTTP_409_CONFLICT, "You're already waiting for this book")
    if (db.scalar(select(func.count()).select_from(BookHold).where(BookHold.student_id == s.id, BookHold.status == "waiting")) or 0) >= 3:
        raise HTTPException(status.HTTP_409_CONFLICT, "You can reserve 3 books at a time")
    if db.scalar(select(Loan.id).where(Loan.book_id == b.id, Loan.student_id == s.id, Loan.returned_at.is_(None))):
        raise HTTPException(status.HTTP_409_CONFLICT, "You already have this book")
    db.add(BookHold(school_id=s.school_id, book_id=b.id, student_id=s.id, status="waiting"))
    db.commit()
    return {"ok": True}


@router.delete("/me/student/library/holds/{hold_id}", status_code=204)
def unreserve(hold_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    s = own(db, user)
    h = db.get(BookHold, hold_id)
    if not h or h.student_id != s.id:
        raise not_found("Reservation")
    h.status = "cancelled"
    db.commit()
    return Response(status_code=204)


class ReadIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    title: str = Field(min_length=1, max_length=250)
    author: str | None = Field(default=None, max_length=200)
    rating: int | None = Field(default=None, ge=1, le=5)
    review: str | None = Field(default=None, max_length=500)
    finished_on: date | None = None
    loan_id: uuid.UUID | None = None


@router.post("/me/student/reading", status_code=201)
def log_book(data: ReadIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    s = own(db, user)
    if data.loan_id:
        l = db.get(Loan, data.loan_id)
        if not l or l.student_id != s.id:
            raise not_found("Loan")
        if db.scalar(select(ReadingEntry.id).where(ReadingEntry.loan_id == l.id)):
            raise HTTPException(status.HTTP_409_CONFLICT, "Already in your reading list")
    day = data.finished_on or now_wat().date()
    if day > now_wat().date() or day < now_wat().date() - timedelta(days=400):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Choose when you finished it")
    db.add(ReadingEntry(student_id=s.id, loan_id=data.loan_id, title=data.title, author=data.author, rating=data.rating, review=data.review, finished_on=day))
    db.commit()
    return {"ok": True}


@router.delete("/me/student/reading/{entry_id}", status_code=204)
def unlog_book(entry_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    s = own(db, user)
    r = db.get(ReadingEntry, entry_id)
    if not r or r.student_id != s.id:
        raise not_found("Book")
    db.delete(r)
    db.commit()
    return Response(status_code=204)


# ---------- Clubs ----------

@router.get("/me/student/clubs")
def clubs(student_id: uuid.UUID | None = None, user: User = Depends(current_user), db: Session = Depends(get_db)):
    s, how = who(db, user, student_id)
    mine = {sc.club_id: sc.role for sc in db.scalars(select(StudentClub).where(StudentClub.student_id == s.id))}
    asks = {r.club_id: r for r in db.scalars(select(ClubRequest).where(ClubRequest.student_id == s.id, ClubRequest.status.in_(["waiting", "declined"])))}
    counts = dict(db.execute(select(StudentClub.club_id, func.count()).join(Student, Student.id == StudentClub.student_id)
                             .where(Student.school_id == s.school_id, Student.status == StudentStatus.active).group_by(StudentClub.club_id)).all())
    out = []
    for c in db.scalars(select(Club).where(Club.school_id == s.school_id).order_by(Club.name)):
        r = asks.get(c.id)
        out.append({"id": str(c.id), "name": c.name, "kind": c.kind.value, "description": c.description, "meeting_time": c.meeting_time,
                    "patron": c.patron_name, "members": counts.get(c.id, 0), "mine": mine.get(c.id),
                    "asked": r.status if r else None, "note": r.note if r else None, "request_id": str(r.id) if r and r.status == "waiting" else None})
    out.sort(key=lambda x: (not x["mine"], not x["asked"], x["name"]))
    return {"clubs": out, "can_act": how == "self"}


class JoinIn(BaseModel):
    why: str | None = Field(default=None, max_length=300)


@router.post("/me/student/clubs/{club_id}/join", status_code=201)
def join(club_id: uuid.UUID, data: JoinIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    s = own(db, user)
    c = db.get(Club, club_id)
    if not c or c.school_id != s.school_id:
        raise not_found("Club")
    if db.scalar(select(StudentClub.id).where(StudentClub.club_id == c.id, StudentClub.student_id == s.id)):
        raise HTTPException(status.HTTP_409_CONFLICT, "You're already in this club")
    if db.scalar(select(ClubRequest.id).where(ClubRequest.club_id == c.id, ClubRequest.student_id == s.id, ClubRequest.status == "waiting")):
        raise HTTPException(status.HTTP_409_CONFLICT, "You've already asked to join")
    if (db.scalar(select(func.count()).select_from(ClubRequest).where(ClubRequest.student_id == s.id, ClubRequest.status == "waiting")) or 0) >= 3:
        raise HTTPException(status.HTTP_409_CONFLICT, "Wait for an answer from the clubs you asked before asking more")
    db.add(ClubRequest(school_id=s.school_id, club_id=c.id, student_id=s.id, why=data.why, status="waiting"))
    to = {c.patron_user_id} if c.patron_user_id else rights.school_roles_users(db, s.school_id, {"vice_principal"})
    for uid in to:
        db.add(Notice(user_id=uid, school_id=s.school_id, kind="request", icon="club",
                      text=f"{s.full_name} ({s.school_class.name if s.school_class else ''}) asks to join {c.name}." + (f" “{data.why[:120]}”" if data.why else ""), link="#/"))
    db.commit()
    return {"ok": True}


@router.delete("/me/student/clubs/requests/{request_id}", status_code=204)
def cancel_join(request_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    s = own(db, user)
    r = db.get(ClubRequest, request_id)
    if not r or r.student_id != s.id or r.status != "waiting":
        raise not_found("Request")
    r.status = "cancelled"
    db.commit()
    return Response(status_code=204)


def may_decide_club(db: Session, user: User, c: Club) -> bool:
    school = db.get(School, c.school_id)
    return c.patron_user_id == user.id or (rights.has(user, school, "students.change", db) and not rights.acting(user))


@router.get("/me/schools/{school_id}/club-requests")
def club_requests(school_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Requests to join the clubs this person runs (or every club, for the office)."""
    out = []
    for r, c, s in db.execute(select(ClubRequest, Club, Student).join(Club, Club.id == ClubRequest.club_id).join(Student, Student.id == ClubRequest.student_id)
                              .where(ClubRequest.school_id == school_id, ClubRequest.status == "waiting").order_by(ClubRequest.created_at)):
        if may_decide_club(db, user, c):
            out.append({"id": str(r.id), "club": c.name, "club_id": str(c.id), "student": {"id": str(s.id), "name": s.full_name, "thumb": s.photo_thumb,
                        "class_name": s.school_class.name if s.school_class else None}, "why": r.why, "at": r.created_at.isoformat()})
    return out


class DecideIn(BaseModel):
    accept: bool
    note: str | None = Field(default=None, max_length=200)


@router.post("/club-requests/{request_id}/decide")
def decide_club(request_id: uuid.UUID, data: DecideIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    r = db.get(ClubRequest, request_id)
    if not r or r.status != "waiting":
        raise not_found("Request")
    c = db.get(Club, r.club_id)
    if not may_decide_club(db, user, c):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the club's patron or the school office can decide")
    s = db.get(Student, r.student_id)
    r.status, r.decided_by_id, r.note = ("accepted" if data.accept else "declined"), user.id, data.note
    if data.accept and not db.scalar(select(StudentClub.id).where(StudentClub.club_id == c.id, StudentClub.student_id == s.id)):
        db.add(StudentClub(student_id=s.id, club_id=c.id, role="Member"))
    if s.user_id:
        db.add(Notice(user_id=s.user_id, school_id=s.school_id, kind="info", icon="club",
                      text=(f"Welcome to {c.name}! 🎉" if data.accept else f"{c.name} can't take you this time.") + (f" “{data.note}”" if data.note else "")))
    db.commit()
    return {"status": r.status}


# ---------- Goals ----------

def goal_out(g: StudentGoal) -> dict:
    return {"id": str(g.id), "title": g.title, "area": g.area, "area_label": GOAL_AREAS.get(g.area, g.area), "target_on": g.target_on.isoformat() if g.target_on else None,
            "progress": g.progress, "status": g.status, "steps": g.steps or [], "updates": list(reversed(g.updates or []))[:5], "teacher_note": g.teacher_note,
            "at": g.created_at.isoformat()}


class GoalIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    title: str = Field(min_length=3, max_length=150)
    area: str = Field(default="study", max_length=15)
    target_on: date | None = None
    steps: list[str] = Field(default_factory=list, max_length=6)


@router.post("/me/student/goals", status_code=201)
def add_goal(data: GoalIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    s = own(db, user)
    if (db.scalar(select(func.count()).select_from(StudentGoal).where(StudentGoal.student_id == s.id, StudentGoal.status == "active")) or 0) >= 5:
        raise HTTPException(status.HTTP_409_CONFLICT, "Five goals at a time is plenty. Finish or drop one first.")
    g = StudentGoal(student_id=s.id, title=data.title, area=data.area if data.area in GOAL_AREAS else "other", target_on=data.target_on,
                    steps=[{"text": t.strip()[:120], "done": False} for t in data.steps if t.strip()], updates=[], progress=0, status="active")
    db.add(g)
    db.commit()
    return goal_out(g)


class GoalUpdate(BaseModel):
    progress: int | None = Field(default=None, ge=0, le=100)
    status: str | None = Field(default=None, pattern="^(active|done|dropped)$")
    steps: list[dict] | None = Field(default=None, max_length=6)
    text: str | None = Field(default=None, max_length=300)


@router.put("/me/student/goals/{goal_id}")
def update_goal(goal_id: uuid.UUID, data: GoalUpdate, user: User = Depends(current_user), db: Session = Depends(get_db)):
    s = own(db, user)
    g = db.get(StudentGoal, goal_id)
    if not g or g.student_id != s.id:
        raise not_found("Goal")
    if data.steps is not None:
        g.steps = [{"text": str(x.get("text", ""))[:120], "done": bool(x.get("done"))} for x in data.steps if str(x.get("text", "")).strip()]
        if g.steps and data.progress is None:
            g.progress = round(100 * sum(1 for x in g.steps if x["done"]) / len(g.steps))
    if data.progress is not None:
        g.progress = data.progress
    if data.status:
        g.status = data.status
        if data.status == "done":
            g.progress = 100
    if data.text:
        g.updates = [*(g.updates or []), {"at": datetime.now(timezone.utc).isoformat(), "text": data.text.strip(), "progress": g.progress}]
    if g.status == "done" and data.status == "done":
        c = db.get(SchoolClass, s.class_id) if s.class_id else None
        if c and c.form_teacher_id:
            db.add(Notice(user_id=c.form_teacher_id, school_id=s.school_id, kind="info", icon="target", text=f"{s.full_name} reached a goal: “{g.title}”. 🎯",
                          link=f"#/student/{s.id}"))
    db.commit()
    return goal_out(g)


class NoteIn(BaseModel):
    note: str = Field(min_length=2, max_length=300)


@router.put("/goals/{goal_id}/teacher-note")
def goal_note(goal_id: uuid.UUID, data: NoteIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """A word of encouragement from the form teacher (or anyone who looks after the student)."""
    from app.api.student360 import access_for
    g = db.get(StudentGoal, goal_id)
    if not g:
        raise not_found("Goal")
    s = db.get(Student, g.student_id)
    a = access_for(db, user, s)
    if not (a.edit or a.teacher) or rights.acting(user):
        raise not_found("Goal")
    g.teacher_note = f"{data.note.strip()} — {user.full_name}"
    if s.user_id:
        db.add(Notice(user_id=s.user_id, school_id=s.school_id, kind="info", icon="target", text=f"{user.full_name} left a note on your goal “{g.title}”."))
    db.commit()
    return goal_out(g)


@router.get("/students/{student_id}/goals")
def student_goals(student_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    from app.api.student360 import get_student
    s, _ = get_student(db, user, student_id)
    return [goal_out(g) for g in db.scalars(select(StudentGoal).where(StudentGoal.student_id == s.id, StudentGoal.status != "dropped").order_by(StudentGoal.created_at.desc()))]


# ---------- Report a worry ----------

def worry_out(c: Concern, for_student: bool = False, db: Session | None = None) -> dict:
    out = {"id": str(c.id), "kind": c.kind, "kind_label": WORRY_KINDS.get(c.kind, c.kind), "text": c.text, "about": c.about, "where": c.where, "urgent": c.urgent,
           "status": c.status, "reply": c.reply, "at": c.created_at.isoformat(),
           "status_label": {"new": "Sent", "seen": "Seen by a trusted adult", "acting": "Being looked into", "closed": "Sorted"}.get(c.status, c.status)}
    if not for_student and db:
        s = db.get(Student, c.student_id)
        h = db.get(User, c.handled_by_id) if c.handled_by_id else None
        out.update({"student": {"id": str(s.id), "name": s.full_name, "class_name": s.school_class.name if s.school_class else None, "thumb": s.photo_thumb} if s else None,
                    "handled_by": h.full_name if h else None, "notes": c.notes or []})
    return out


def guardians_of_safety(db: Session, school: School) -> set[uuid.UUID]:
    ids = set(db.scalars(select(Membership.user_id).where(Membership.school_id == school.id, Membership.role.in_(STAFF_ROLES))))
    out = set()
    for u in db.scalars(select(User).where(User.id.in_(ids or {uuid.uuid4()}), User.is_active.is_(True))):
        if rights.has(u, school, "private.safeguarding", db):
            out.add(u.id)
    return out


class WorryIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    kind: str = Field(pattern="^(bullying|unsafe|sad|online|health|other)$")
    text: str = Field(min_length=5, max_length=3000)
    about: str | None = Field(default=None, max_length=200)
    where: str | None = Field(default=None, max_length=120)
    urgent: bool = False


@router.post("/me/student/worries", status_code=201)
def report_worry(data: WorryIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    s = own(db, user)
    school = db.get(School, s.school_id)
    recent = db.scalar(select(func.count()).select_from(Concern).where(Concern.student_id == s.id, Concern.created_at >= datetime.now(timezone.utc) - timedelta(hours=1))) or 0
    if recent >= 5:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "You've sent a lot just now. A trusted adult will reply soon. If it's an emergency, find a teacher straight away.")
    c = Concern(school_id=s.school_id, student_id=s.id, notes=[], **data.model_dump())
    db.add(c)
    db.flush()
    text = ("URGENT: " if data.urgent else "") + f"A student has reported a worry ({WORRY_KINDS[data.kind].lower()}). Open Students → Worries."
    for uid in guardians_of_safety(db, school):
        db.add(Notice(user_id=uid, school_id=s.school_id, kind="private", icon="shield", text=text, link=f"#/school/{s.school_id}/students"))
    db.commit()
    return worry_out(c, for_student=True)


@router.get("/schools/{school_id}/worries")
def school_worries(school_id: uuid.UUID, show: str = Query("open", pattern="^(open|all)$"), user: User = Depends(current_user), db: Session = Depends(get_db)):
    school = db.get(School, school_id)
    if not school:
        raise not_found("School")
    check(user, school, "students")
    if not rights.has(user, school, "private.safeguarding", db) or rights.acting(user):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "private:safeguarding|Worries reported by students are only for the safeguarding team.")
    q = select(Concern).where(Concern.school_id == school_id)
    if show == "open":
        q = q.where(Concern.status != "closed")
    rows = list(db.scalars(q.order_by(Concern.urgent.desc(), Concern.created_at.desc()).limit(200)))
    rights.use_private(db, user, school, "safeguarding", "worries reported by students")
    db.commit()
    return {"worries": [worry_out(c, db=db) for c in rows], "open": sum(1 for c in rows if c.status != "closed"), "kinds": WORRY_KINDS}


class WorryUpdate(BaseModel):
    status: str | None = Field(default=None, pattern="^(seen|acting|closed)$")
    reply: str | None = Field(default=None, max_length=500)
    note: str | None = Field(default=None, max_length=1000)


@router.put("/worries/{worry_id}")
def handle_worry(worry_id: uuid.UUID, data: WorryUpdate, user: User = Depends(current_user), db: Session = Depends(get_db)):
    c = db.get(Concern, worry_id)
    if not c:
        raise not_found("Worry")
    school = db.get(School, c.school_id)
    if not rights.has(user, school, "private.safeguarding", db) or rights.acting(user):
        raise not_found("Worry")
    s = db.get(Student, c.student_id)
    if data.status:
        c.status = data.status
        c.handled_by_id = user.id
        if data.status == "closed":
            c.closed_at = datetime.now(timezone.utc)
    if data.note:
        c.notes = [*(c.notes or []), {"at": datetime.now(timezone.utc).isoformat(), "by": user.full_name, "text": data.note.strip()}]
    if data.reply:
        c.reply = data.reply.strip()
        if s and s.user_id:
            db.add(Notice(user_id=s.user_id, school_id=s.school_id, kind="info", icon="shield", text="A trusted adult has replied to what you told the school. Open “Report a worry” to read it."))
    rights.use_private(db, user, school, "safeguarding", s.full_name if s else "a student")
    db.commit()
    return worry_out(c, db=db)
