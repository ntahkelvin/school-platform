"""The library: catalogue, copies with numbers, lending and returns at the desk (scan or type), holds,
library cards, and offline insights on reading."""
import re
import uuid
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.api.access import not_found
from app.api.deps import current_user
from app.api.ops import Names, desk_members, student_card
from app.api.staff_day import now_wat, runs, school_for, staff_ids
from app.core import rights
from app.core.db import get_db
from app.models import (
    Book, BookCopy, BookHold, LibrarySettings, Loan, Notice, School, SchoolClass, Student, User,
)
from app.models.people import StudentStatus

router = APIRouter(prefix="/api", tags=["library"])

CATEGORIES = {"textbook": "Textbook", "literature": "Literature", "fiction": "Story book", "reference": "Reference",
              "religious": "Religious", "magazine": "Magazine or paper", "other": "Other"}
CONDITIONS = {"new": "New", "good": "Good", "fair": "Fair", "poor": "Poor"}
COPY_STATUS = {"available": "On the shelf", "on_loan": "On loan", "lost": "Lost", "damaged": "Damaged", "withdrawn": "Withdrawn"}


@router.get("/library/meta")
def meta(user: User = Depends(current_user)):
    return {"categories": CATEGORIES, "conditions": CONDITIONS, "copy_status": COPY_STATUS}


def settings_for(db: Session, school_id: uuid.UUID) -> LibrarySettings:
    st = db.scalar(select(LibrarySettings).where(LibrarySettings.school_id == school_id))
    if not st:
        st = LibrarySettings(school_id=school_id, student_days=14, staff_days=30, student_max=2, staff_max=5, renewals=1, next_number=1)
        db.add(st)
        db.flush()
    return st


def librarian(db: Session, user: User, school: School, level: str | None = None) -> bool:
    if user.id in desk_members(db, school.id, "library"):
        return not (level == "change" and rights.acting(user))
    return runs(user, school, "library", level)


def need_lib(db: Session, user: User, school_id: uuid.UUID) -> School:
    s = school_for(db, user, school_id)
    if not librarian(db, user, s):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the library team can do this")
    return s


def today() -> date:
    return now_wat().date()


# ---------- Settings ----------

class SettingsIO(BaseModel):
    student_days: int = Field(ge=1, le=120)
    staff_days: int = Field(ge=1, le=365)
    student_max: int = Field(ge=1, le=20)
    staff_max: int = Field(ge=1, le=50)
    renewals: int = Field(ge=0, le=10)


@router.get("/schools/{school_id}/library/settings", response_model=SettingsIO)
def get_settings(school_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    need_lib(db, user, school_id)
    st = settings_for(db, school_id)
    db.commit()
    return SettingsIO(**{k: getattr(st, k) for k in SettingsIO.model_fields})


@router.put("/schools/{school_id}/library/settings", response_model=SettingsIO)
def put_settings(school_id: uuid.UUID, data: SettingsIO, user: User = Depends(current_user), db: Session = Depends(get_db)):
    need_lib(db, user, school_id)
    st = settings_for(db, school_id)
    for k, v in data.model_dump().items():
        setattr(st, k, v)
    db.commit()
    return data


# ---------- Catalogue ----------

class BookIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    title: str = Field(min_length=1, max_length=250)
    author: str | None = Field(default=None, max_length=200)
    isbn: str | None = Field(default=None, max_length=20)
    publisher: str | None = Field(default=None, max_length=120)
    year: int | None = Field(default=None, ge=1500, le=2100)
    category: str = "textbook"
    subject: str | None = Field(default=None, max_length=80)
    level: str | None = Field(default=None, max_length=40)
    shelf: str | None = Field(default=None, max_length=40)
    summary: str | None = Field(default=None, max_length=2000)
    colour: str | None = Field(default=None, max_length=9)
    copies: int = Field(default=1, ge=0, le=300)


def add_copies(db: Session, school_id: uuid.UUID, book_id: uuid.UUID, n: int) -> list[str]:
    st = settings_for(db, school_id)
    out = []
    for _ in range(n):
        num = f"L{st.next_number:05d}"
        st.next_number += 1
        db.add(BookCopy(school_id=school_id, book_id=book_id, number=num, status="available", condition="new"))
        out.append(num)
    db.flush()
    return out


def book_row(b: Book, copies: list[BookCopy], holds: int, borrowed: int) -> dict:
    live = [c for c in copies if c.status not in ("lost", "withdrawn")]
    return {"id": str(b.id), "title": b.title, "author": b.author, "isbn": b.isbn, "publisher": b.publisher, "year": b.year,
            "category": b.category, "category_label": CATEGORIES.get(b.category, b.category), "subject": b.subject, "level": b.level,
            "shelf": b.shelf, "summary": b.summary, "colour": b.colour, "copies": len(live),
            "available": sum(1 for c in live if c.status == "available"), "out": sum(1 for c in live if c.status == "on_loan"),
            "holds": holds, "borrowed_90": borrowed}


@router.get("/schools/{school_id}/library/books")
def books(school_id: uuid.UUID, q: str | None = None, category: str | None = None, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """The catalogue. Anyone on the staff may search it (to find a book or ask for one)."""
    school_for(db, user, school_id)
    stmt = select(Book).where(Book.school_id == school_id)
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(or_(Book.title.ilike(like), Book.author.ilike(like), Book.subject.ilike(like), Book.isbn.ilike(like)))
    if category:
        stmt = stmt.where(Book.category == category)
    rows = list(db.scalars(stmt.order_by(Book.title).limit(600)))
    ids = [b.id for b in rows] or [uuid.uuid4()]
    copies = defaultdict(list)
    for c in db.scalars(select(BookCopy).where(BookCopy.book_id.in_(ids))):
        copies[c.book_id].append(c)
    holds = Counter(db.scalars(select(BookHold.book_id).where(BookHold.book_id.in_(ids), BookHold.status == "waiting")))
    since = datetime.now(timezone.utc) - timedelta(days=90)
    borrowed = Counter(db.scalars(select(Loan.book_id).where(Loan.book_id.in_(ids), Loan.issued_at >= since)))
    return [book_row(b, copies[b.id], holds[b.id], borrowed[b.id]) for b in rows]


@router.post("/schools/{school_id}/library/books", status_code=201)
def add_book(school_id: uuid.UUID, data: BookIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    need_lib(db, user, school_id)
    if data.category not in CATEGORIES:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Choose a kind of book")
    if data.isbn and db.scalar(select(Book.id).where(Book.school_id == school_id, Book.isbn == data.isbn)):
        raise HTTPException(status.HTTP_409_CONFLICT, "A book with this ISBN is already in the catalogue. Add copies to it instead.")
    body = data.model_dump(exclude={"copies"})
    b = Book(school_id=school_id, **body)
    db.add(b)
    db.flush()
    numbers = add_copies(db, school_id, b.id, data.copies)
    db.commit()
    return {**book_detail(db, b), "new_numbers": numbers}


def get_book(db: Session, user: User, book_id: uuid.UUID, manage: bool = True) -> Book:
    b = db.get(Book, book_id)
    if not b:
        raise not_found("Book")
    if manage:
        need_lib(db, user, b.school_id)
    else:
        school_for(db, user, b.school_id)
    return b


def borrower_of(db: Session, l: Loan, nm: Names) -> dict:
    if l.student_id:
        return {"kind": "student", **(student_card(db, db.get(Student, l.student_id)) or {})}
    c = nm.card(l.user_id) or {}
    return {"kind": "staff", "id": str(l.user_id), "name": c.get("name"), "class_name": c.get("job_title")}


def loan_out(db: Session, l: Loan, nm: Names, books: dict | None = None, copies: dict | None = None) -> dict:
    b = (books or {}).get(l.book_id) or db.get(Book, l.book_id)
    c = (copies or {}).get(l.copy_id) or db.get(BookCopy, l.copy_id)
    late = (today() - l.due_on).days if not l.returned_at else 0
    return {"id": str(l.id), "book": {"id": str(b.id), "title": b.title, "author": b.author, "colour": b.colour}, "number": c.number,
            "borrower": borrower_of(db, l, nm), "issued_at": l.issued_at.isoformat(), "due_on": l.due_on.isoformat(),
            "returned_at": l.returned_at.isoformat() if l.returned_at else None, "renewals": l.renewals, "outcome": l.outcome,
            "days_late": max(0, late), "issued_by": nm.name(l.issued_by_id)}


def book_detail(db: Session, b: Book) -> dict:
    copies = list(db.scalars(select(BookCopy).where(BookCopy.book_id == b.id).order_by(BookCopy.number)))
    holds = list(db.scalars(select(BookHold).where(BookHold.book_id == b.id, BookHold.status == "waiting").order_by(BookHold.created_at)))
    nm = Names(db, b.school_id)
    open_loans = {l.copy_id: l for l in db.scalars(select(Loan).where(Loan.book_id == b.id, Loan.returned_at.is_(None)))}
    history = list(db.scalars(select(Loan).where(Loan.book_id == b.id).order_by(Loan.issued_at.desc()).limit(25)))
    since = datetime.now(timezone.utc) - timedelta(days=90)
    return {**book_row(b, copies, len(holds), sum(1 for l in history if l.issued_at >= since)),
            "copy_list": [{"id": str(c.id), "number": c.number, "status": c.status, "status_label": COPY_STATUS[c.status], "condition": c.condition,
                           "note": c.note, "loan": loan_out(db, open_loans[c.id], nm) if c.id in open_loans else None} for c in copies],
            "holds": [{"id": str(h.id), "who": borrower_of(db, h, nm), "at": h.created_at.isoformat()} for h in holds],
            "history": [loan_out(db, l, nm) for l in history]}


@router.get("/library/books/{book_id}")
def one_book(book_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    b = get_book(db, user, book_id, manage=False)
    out = book_detail(db, b)
    if not librarian(db, user, db.get(School, b.school_id)):
        out["copy_list"] = [{**c, "loan": None} for c in out["copy_list"]]
        out["history"], out["holds"] = [], [{"id": h["id"], "who": {"name": "Someone"}, "at": h["at"]} for h in out["holds"]]
    return out


@router.put("/library/books/{book_id}")
def edit_book(book_id: uuid.UUID, data: BookIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    b = get_book(db, user, book_id)
    for k, v in data.model_dump(exclude={"copies"}).items():
        setattr(b, k, v)
    db.commit()
    return book_detail(db, b)


@router.delete("/library/books/{book_id}", status_code=204)
def delete_book(book_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    b = get_book(db, user, book_id)
    if db.scalar(select(Loan.id).where(Loan.book_id == b.id, Loan.returned_at.is_(None))):
        raise HTTPException(status.HTTP_409_CONFLICT, "Some copies are still out on loan")
    db.delete(b)
    db.commit()
    return Response(status_code=204)


class CopiesIn(BaseModel):
    count: int = Field(ge=1, le=300)


@router.post("/library/books/{book_id}/copies")
def more_copies(book_id: uuid.UUID, data: CopiesIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    b = get_book(db, user, book_id)
    nums = add_copies(db, b.school_id, b.id, data.count)
    db.commit()
    return {**book_detail(db, b), "new_numbers": nums}


class CopyIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    status: str | None = Field(default=None, pattern="^(available|lost|damaged|withdrawn)$")
    condition: str | None = Field(default=None, pattern="^(new|good|fair|poor)$")
    note: str | None = Field(default=None, max_length=200)


@router.put("/library/copies/{copy_id}")
def edit_copy(copy_id: uuid.UUID, data: CopyIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    c = db.get(BookCopy, copy_id)
    if not c:
        raise not_found("Copy")
    need_lib(db, user, c.school_id)
    if c.status == "on_loan" and data.status:
        raise HTTPException(status.HTTP_409_CONFLICT, "Return the copy first")
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(c, k, v)
    db.commit()
    return book_detail(db, db.get(Book, c.book_id))


# ---------- Who is borrowing ----------

def student_code(school: School, s: Student) -> str:
    return f"SP1:P:{school.id.hex[:8]}:{s.id.hex}"


def find_borrower(db: Session, school: School, code: str) -> dict | None:
    code = code.strip()
    m = re.match(r"^SP1:([PS]):([0-9a-f]{8}):([0-9a-f]{32})$", code)
    if m:
        if m.group(2) != school.id.hex[:8]:
            return None
        if m.group(1) == "P":
            s = db.get(Student, uuid.UUID(m.group(3)))
            return {"student": s} if s and s.school_id == school.id else None
        uid = uuid.UUID(m.group(3))
        return {"user": db.get(User, uid)} if uid in staff_ids(db, school.id) else None
    s = db.scalar(select(Student).where(Student.school_id == school.id, func.lower(Student.admission_no) == code.lower()))
    return {"student": s} if s else None


def borrower_info(db: Session, school: School, student: Student | None = None, user_: User | None = None) -> dict:
    st = settings_for(db, school.id)
    nm = Names(db, school.id)
    q = select(Loan).where(Loan.school_id == school.id, Loan.returned_at.is_(None))
    q = q.where(Loan.student_id == student.id) if student else q.where(Loan.user_id == user_.id)
    loans = [loan_out(db, l, nm) for l in db.scalars(q.order_by(Loan.due_on))]
    total = db.scalar(select(func.count()).select_from(Loan).where(Loan.student_id == student.id if student else Loan.user_id == user_.id)) or 0
    card = {"kind": "student", **student_card(db, student)} if student else {"kind": "staff", "id": str(user_.id), **(nm.card(user_.id) or {"name": user_.full_name})}
    limit = st.student_max if student else st.staff_max
    return {"borrower": card, "loans": loans, "limit": limit, "can_borrow": max(0, limit - len(loans)),
            "overdue": sum(1 for l in loans if l["days_late"] > 0), "books_ever": total,
            "due_on": (today() + timedelta(days=st.student_days if student else st.staff_days)).isoformat()}


@router.get("/schools/{school_id}/library/find")
def find(school_id: uuid.UUID, code: str = Query(min_length=1, max_length=120), user: User = Depends(current_user), db: Session = Depends(get_db)):
    """What a scanned or typed code is: a copy (L00042), a student's library card or admission number, or a staff card."""
    school = need_lib(db, user, school_id)
    c = db.scalar(select(BookCopy).where(BookCopy.school_id == school_id, func.upper(BookCopy.number) == code.strip().upper()))
    if c:
        b = db.get(Book, c.book_id)
        loan = db.scalar(select(Loan).where(Loan.copy_id == c.id, Loan.returned_at.is_(None)))
        return {"kind": "copy", "copy": {"id": str(c.id), "number": c.number, "status": c.status, "condition": c.condition},
                "book": book_row(b, list(db.scalars(select(BookCopy).where(BookCopy.book_id == b.id))), 0, 0),
                "loan": loan_out(db, loan, Names(db, school_id)) if loan else None}
    who = find_borrower(db, school, code)
    if who:
        return {"kind": "borrower", **borrower_info(db, school, who.get("student"), who.get("user"))}
    raise HTTPException(status.HTTP_404_NOT_FOUND, "Nothing found for that code. Check the number and try again.")


@router.get("/schools/{school_id}/library/borrower")
def borrower(school_id: uuid.UUID, student_id: uuid.UUID | None = None, user_id: uuid.UUID | None = None,
             user: User = Depends(current_user), db: Session = Depends(get_db)):
    school = need_lib(db, user, school_id)
    if student_id:
        s = db.get(Student, student_id)
        if not s or s.school_id != school_id:
            raise not_found("Student")
        return borrower_info(db, school, student=s)
    if user_id and user_id in staff_ids(db, school_id):
        return borrower_info(db, school, user_=db.get(User, user_id))
    raise not_found("Borrower")


# ---------- Lending and returns ----------

class IssueIn(BaseModel):
    student_id: uuid.UUID | None = None
    user_id: uuid.UUID | None = None
    numbers: list[str] = Field(min_length=1, max_length=20)
    due_on: date | None = None
    skip_queue: bool = False


@router.post("/schools/{school_id}/library/issue")
def issue(school_id: uuid.UUID, data: IssueIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    school = need_lib(db, user, school_id)
    st = settings_for(db, school_id)
    student = db.get(Student, data.student_id) if data.student_id else None
    staffer = db.get(User, data.user_id) if data.user_id and data.user_id in staff_ids(db, school_id) else None
    if not ((student and student.school_id == school_id and student.status == StudentStatus.active) or staffer):
        raise not_found("Borrower")
    info = borrower_info(db, school, student, staffer)
    if info["overdue"]:
        raise HTTPException(status.HTTP_409_CONFLICT, f"{info['borrower']['name']} has {info['overdue']} overdue book{'s' if info['overdue'] > 1 else ''}. Return them first.")
    if len(data.numbers) > info["can_borrow"]:
        raise HTTPException(status.HTTP_409_CONFLICT, f"{info['borrower']['name']} can borrow {info['can_borrow']} more (the limit is {info['limit']}).")
    due = data.due_on or (today() + timedelta(days=st.student_days if student else st.staff_days))
    done = []
    for num in dict.fromkeys(n.strip().upper() for n in data.numbers):
        c = db.scalar(select(BookCopy).where(BookCopy.school_id == school_id, func.upper(BookCopy.number) == num))
        if not c:
            raise HTTPException(status.HTTP_404_NOT_FOUND, f"No copy numbered {num}")
        if c.status != "available":
            raise HTTPException(status.HTTP_409_CONFLICT, f"{num} is {COPY_STATUS[c.status].lower()}")
        b = db.get(Book, c.book_id)
        first = db.scalar(select(BookHold).where(BookHold.book_id == b.id, BookHold.status == "waiting").order_by(BookHold.created_at))
        mine = first and ((student and first.student_id == student.id) or (staffer and first.user_id == staffer.id))
        if first and not mine and not data.skip_queue:
            holder = borrower_of(db, first, Names(db, school_id))["name"]
            raise HTTPException(status.HTTP_409_CONFLICT, f"“{b.title}” is kept for {holder}, who asked first.")
        if mine:
            first.status = "done"
        c.status = "on_loan"
        db.add(Loan(school_id=school_id, copy_id=c.id, book_id=b.id, student_id=student.id if student else None,
                    user_id=staffer.id if staffer else None, issued_by_id=user.id, issued_at=datetime.now(timezone.utc), due_on=due))
        done.append({"number": c.number, "title": b.title})
    db.commit()
    return {"issued": done, "due_on": due.isoformat(), **borrower_info(db, school, student, staffer)}


class ReturnIn(BaseModel):
    number: str = Field(min_length=1, max_length=20)
    outcome: str = Field(default="returned", pattern="^(returned|lost|damaged)$")
    condition: str | None = Field(default=None, pattern="^(new|good|fair|poor)$")
    note: str | None = Field(default=None, max_length=200)


@router.post("/schools/{school_id}/library/return")
def give_back(school_id: uuid.UUID, data: ReturnIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    need_lib(db, user, school_id)
    c = db.scalar(select(BookCopy).where(BookCopy.school_id == school_id, func.upper(BookCopy.number) == data.number.strip().upper()))
    if not c:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"No copy numbered {data.number}")
    loan = db.scalar(select(Loan).where(Loan.copy_id == c.id, Loan.returned_at.is_(None)))
    if not loan:
        raise HTTPException(status.HTTP_409_CONFLICT, f"{c.number} is not out on loan")
    nm = Names(db, school_id)
    loan.returned_at, loan.returned_by_id, loan.outcome, loan.note = datetime.now(timezone.utc), user.id, data.outcome, data.note
    c.status = {"returned": "available", "lost": "lost", "damaged": "damaged"}[data.outcome]
    if data.condition:
        c.condition = data.condition
    b = db.get(Book, c.book_id)
    out = loan_out(db, loan, nm)
    waiting = db.scalar(select(BookHold).where(BookHold.book_id == b.id, BookHold.status == "waiting").order_by(BookHold.created_at))
    keep_for = None
    if waiting and c.status == "available":
        keep_for = borrower_of(db, waiting, nm)["name"]
        if waiting.user_id:
            db.add(Notice(user_id=waiting.user_id, school_id=school_id, kind="info", icon="book",
                          text=f"“{b.title}” is back in the library and kept for you. Collect it from the library desk."))
    db.commit()
    late = (today() - loan.due_on).days
    return {"loan": out, "late_days": max(0, late), "keep_for": keep_for}


@router.post("/library/loans/{loan_id}/renew")
def renew(loan_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    l = db.get(Loan, loan_id)
    if not l or l.returned_at:
        raise not_found("Loan")
    need_lib(db, user, l.school_id)
    st = settings_for(db, l.school_id)
    if l.renewals >= st.renewals:
        raise HTTPException(status.HTTP_409_CONFLICT, "This book has been renewed as many times as allowed")
    if db.scalar(select(BookHold.id).where(BookHold.book_id == l.book_id, BookHold.status == "waiting")):
        raise HTTPException(status.HTTP_409_CONFLICT, "Someone else is waiting for this book, so it can't be renewed")
    l.renewals += 1
    l.due_on = max(l.due_on, today()) + timedelta(days=st.student_days if l.student_id else st.staff_days)
    db.commit()
    return loan_out(db, l, Names(db, l.school_id))


@router.get("/schools/{school_id}/library/loans")
def loans(school_id: uuid.UUID, scope: str = Query("out", pattern="^(out|overdue|recent)$"), user: User = Depends(current_user), db: Session = Depends(get_db)):
    need_lib(db, user, school_id)
    q = select(Loan).where(Loan.school_id == school_id)
    if scope == "recent":
        q = q.order_by(func.coalesce(Loan.returned_at, Loan.issued_at).desc()).limit(80)
    else:
        q = q.where(Loan.returned_at.is_(None))
        if scope == "overdue":
            q = q.where(Loan.due_on < today())
        q = q.order_by(Loan.due_on).limit(500)
    nm = Names(db, school_id)
    return [loan_out(db, l, nm) for l in db.scalars(q)]


# ---------- Holds ----------

class HoldIn(BaseModel):
    book_id: uuid.UUID
    student_id: uuid.UUID | None = None


@router.post("/schools/{school_id}/library/holds", status_code=201)
def hold(school_id: uuid.UUID, data: HoldIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """The library desk can put a student in the queue; a member of staff can ask for a book for themselves."""
    school = school_for(db, user, school_id)
    b = db.get(Book, data.book_id)
    if not b or b.school_id != school_id:
        raise not_found("Book")
    if data.student_id:
        if not librarian(db, user, school):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the library team can do this")
        s = db.get(Student, data.student_id)
        if not s or s.school_id != school_id:
            raise not_found("Student")
        who = {"student_id": s.id}
    else:
        if user.id not in staff_ids(db, school_id):
            raise not_found("Staff member")
        who = {"user_id": user.id}
    exists = db.scalar(select(BookHold.id).where(BookHold.book_id == b.id, BookHold.status == "waiting",
                                                 *(getattr(BookHold, k) == v for k, v in who.items())))
    if exists:
        raise HTTPException(status.HTTP_409_CONFLICT, "Already waiting for this book")
    db.add(BookHold(school_id=school_id, book_id=b.id, status="waiting", **who))
    db.commit()
    return book_detail(db, b) if librarian(db, user, school) else {"ok": True}


@router.delete("/library/holds/{hold_id}", status_code=204)
def cancel_hold(hold_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    h = db.get(BookHold, hold_id)
    if not h:
        raise not_found("Hold")
    school = school_for(db, user, h.school_id)
    if h.user_id != user.id and not librarian(db, user, school):
        raise not_found("Hold")
    h.status = "cancelled"
    db.commit()
    return Response(status_code=204)


# ---------- Overview, reading and insights ----------

def term_start() -> date:
    d = today()
    return date(d.year, 9, 1) if d.month >= 9 else date(d.year, 4, 15) if d.month >= 4 else date(d.year, 1, 6)


@router.get("/schools/{school_id}/library/overview")
def overview(school_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    need_lib(db, user, school_id)
    now = datetime.now(timezone.utc)
    d = today()
    titles = db.scalar(select(func.count()).select_from(Book).where(Book.school_id == school_id)) or 0
    copies = list(db.scalars(select(BookCopy).where(BookCopy.school_id == school_id)))
    live = [c for c in copies if c.status not in ("lost", "withdrawn")]
    out = list(db.scalars(select(Loan).where(Loan.school_id == school_id, Loan.returned_at.is_(None))))
    overdue = [l for l in out if l.due_on < d]
    since = datetime.combine(term_start(), datetime.min.time(), tzinfo=timezone.utc)
    term = list(db.scalars(select(Loan).where(Loan.school_id == school_id, Loan.issued_at >= since)))
    start_day = datetime.combine(d, datetime.min.time(), tzinfo=timezone.utc) - timedelta(hours=1)
    today_out = sum(1 for l in term if l.issued_at >= start_day)
    today_back = db.scalar(select(func.count()).select_from(Loan).where(Loan.school_id == school_id, Loan.returned_at >= start_day)) or 0
    readers = {l.student_id for l in term if l.student_id}
    active = db.scalar(select(func.count()).select_from(Student).where(Student.school_id == school_id, Student.status == StudentStatus.active)) or 1
    nm = Names(db, school_id)
    books = {b.id: b for b in db.scalars(select(Book).where(Book.school_id == school_id))}
    copy_map = {c.id: c for c in copies}
    tips = insights(db, school_id, books, live, out, overdue, term, readers, active)
    db.commit()
    return {"stats": {"titles": titles, "copies": len(live), "out": len(out), "overdue": len(overdue), "today_out": today_out,
                      "today_back": today_back, "term_loans": len(term), "readers": len(readers), "reader_share": round(100 * len(readers) / active)},
            "overdue": [loan_out(db, l, nm, books, copy_map) for l in sorted(overdue, key=lambda l: l.due_on)[:60]],
            "insights": tips, "generated": now.isoformat()}


def insights(db: Session, school_id: uuid.UUID, books: dict, live: list[BookCopy], out: list[Loan], overdue: list[Loan],
             term: list[Loan], readers: set, active: int) -> list[dict]:
    tips: list[dict] = []
    d = today()
    if overdue:
        worst = max(overdue, key=lambda l: (d - l.due_on).days)
        tips.append({"kind": "alert", "icon": "hourglass", "text": f"{len(overdue)} book{'s are' if len(overdue) > 1 else ' is'} overdue. The longest is "
                     f"{(d - worst.due_on).days} days late. Send reminders to form teachers from the Loans tab."})
    holds = Counter(db.scalars(select(BookHold.book_id).where(BookHold.school_id == school_id, BookHold.status == "waiting")))
    avail = Counter(c.book_id for c in live if c.status == "available")
    wanted = [(books[b].title, n) for b, n in holds.items() if b in books and avail[b] == 0 and n >= 2]
    if wanted:
        tips.append({"kind": "tip", "icon": "book", "text": "In demand with no copy on the shelf: " + ", ".join(f"“{t}” ({n} waiting)" for t, n in wanted[:3]) + ". Worth buying more copies."})
    poor = sum(1 for c in live if c.condition == "poor")
    if poor >= 3:
        tips.append({"kind": "grow", "icon": "wrench", "text": f"{poor} copies are in poor condition. A repair afternoon (tape, new covers) keeps them going longer."})
    six = datetime.now(timezone.utc) - timedelta(days=180)
    used = set(db.scalars(select(Loan.book_id).where(Loan.school_id == school_id, Loan.issued_at >= six)))
    idle = [b for b in books.values() if b.id not in used and b.category in ("fiction", "literature")]
    if len(idle) >= 5:
        tips.append({"kind": "tip", "icon": "sparkle", "text": f"{len(idle)} story and literature books haven't been borrowed in 6 months. Put a few on a “Try me” display by the desk."})
    share = round(100 * len(readers) / max(1, active))
    if term and share < 40:
        tips.append({"kind": "grow", "icon": "target", "text": f"Only {share}% of students have borrowed a book this term. A class reading challenge could change that."})
    by_class = Counter()
    for l in term:
        if l.student_id:
            s = db.get(Student, l.student_id)
            if s and s.class_id:
                by_class[s.class_id] += 1
    if len(by_class) >= 3:
        top, low = by_class.most_common()[0], by_class.most_common()[-1]
        tn, ln = db.get(SchoolClass, top[0]), db.get(SchoolClass, low[0])
        tips.append({"kind": "strength", "icon": "trophy", "text": f"{tn.name if tn else '?'} borrowed the most this term ({top[1]} books); {ln.name if ln else '?'} the fewest ({low[1]})."})
    month = datetime.now(timezone.utc) - timedelta(days=30)
    top_readers = Counter(l.student_id for l in term if l.student_id and l.issued_at >= month)
    if top_readers:
        sid, n = top_readers.most_common(1)[0]
        if n >= 3:
            s = db.get(Student, sid)
            tips.append({"kind": "strength", "icon": "star", "text": f"Reader of the month: {s.full_name if s else '?'} with {n} books. Worth a mention at assembly."})
    return tips


@router.get("/schools/{school_id}/library/reading")
def reading(school_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    need_lib(db, user, school_id)
    since = datetime.combine(term_start(), datetime.min.time(), tzinfo=timezone.utc)
    term = list(db.scalars(select(Loan).where(Loan.school_id == school_id, Loan.issued_at >= since)))
    per_student = Counter(l.student_id for l in term if l.student_id)
    per_book = Counter(l.book_id for l in term)
    by_class = Counter()
    sizes = Counter(db.scalars(select(Student.class_id).where(Student.school_id == school_id, Student.status == StudentStatus.active, Student.class_id.is_not(None))))
    for sid, n in per_student.items():
        s = db.get(Student, sid)
        if s and s.class_id:
            by_class[s.class_id] += n
    classes = []
    for cid, size in sizes.items():
        c = db.get(SchoolClass, cid)
        classes.append({"id": str(cid), "name": c.name if c else "?", "loans": by_class[cid], "students": size,
                        "per_student": round(by_class[cid] / size, 2) if size else 0})
    classes.sort(key=lambda x: -x["per_student"])
    return {"since": term_start().isoformat(),
            "readers": [{**student_card(db, db.get(Student, sid)), "books": n} for sid, n in per_student.most_common(15)],
            "books": [{"id": str(b), "title": (db.get(Book, b).title if db.get(Book, b) else "?"), "loans": n} for b, n in per_book.most_common(15)],
            "classes": classes}


@router.post("/schools/{school_id}/library/remind")
def remind(school_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Tell each form teacher which of their students have overdue books."""
    need_lib(db, user, school_id)
    overdue = list(db.scalars(select(Loan).where(Loan.school_id == school_id, Loan.returned_at.is_(None), Loan.due_on < today(), Loan.student_id.is_not(None))))
    per_teacher: dict[uuid.UUID, list[str]] = defaultdict(list)
    staff_late: list[Loan] = []
    for l in overdue:
        s = db.get(Student, l.student_id)
        c = db.get(SchoolClass, s.class_id) if s and s.class_id else None
        if c and c.form_teacher_id:
            per_teacher[c.form_teacher_id].append(f"{s.first_name} {s.last_name} ({c.name})")
    for l in db.scalars(select(Loan).where(Loan.school_id == school_id, Loan.returned_at.is_(None), Loan.due_on < today(), Loan.user_id.is_not(None))):
        staff_late.append(l)
        b = db.get(Book, l.book_id)
        db.add(Notice(user_id=l.user_id, school_id=school_id, kind="info", icon="book",
                      text=f"Your library book “{b.title if b else ''}” was due on {l.due_on:%d %b}. Please bring it back."))
    for tid, names in per_teacher.items():
        names = sorted(set(names))
        db.add(Notice(user_id=tid, school_id=school_id, kind="info", icon="book",
                      text=f"Overdue library books in your class: {', '.join(names[:12])}{' and more' if len(names) > 12 else ''}. Please remind them."))
    db.commit()
    return {"teachers": len(per_teacher), "staff": len(staff_late)}


@router.get("/schools/{school_id}/library/cards")
def cards(school_id: uuid.UUID, class_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Library cards for a class: each with a QR code to scan at the desk."""
    school = need_lib(db, user, school_id)
    c = db.get(SchoolClass, class_id)
    if not c:
        raise not_found("Class")
    rows = db.scalars(select(Student).where(Student.class_id == class_id, Student.status == StudentStatus.active).order_by(Student.last_name, Student.first_name))
    return {"school": {"name": school.name, "logo": school.logo, "colour": school.colour, "motto": school.motto}, "class_name": c.name,
            "cards": [{"id": str(s.id), "name": s.full_name, "admission_no": s.admission_no, "code": student_code(school, s)} for s in rows]}


@router.get("/schools/{school_id}/library/labels")
def labels(school_id: uuid.UUID, numbers: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    school = need_lib(db, user, school_id)
    nums = [n.strip().upper() for n in numbers.split(",") if n.strip()][:300]
    rows = db.execute(select(BookCopy, Book).join(Book, Book.id == BookCopy.book_id).where(BookCopy.school_id == school_id, func.upper(BookCopy.number).in_(nums)))
    return {"school": school.name, "labels": [{"number": c.number, "title": b.title, "shelf": b.shelf} for c, b in rows]}


# ---------- For everyone on the staff ----------

@router.get("/me/schools/{school_id}/library")
def my_library(school_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    school = school_for(db, user, school_id)
    nm = Names(db, school_id)
    loans_ = [loan_out(db, l, nm) for l in db.scalars(select(Loan).where(Loan.school_id == school_id, Loan.user_id == user.id, Loan.returned_at.is_(None)).order_by(Loan.due_on))]
    holds = []
    for h in db.scalars(select(BookHold).where(BookHold.school_id == school_id, BookHold.user_id == user.id, BookHold.status == "waiting")):
        b = db.get(Book, h.book_id)
        ahead = db.scalar(select(func.count()).select_from(BookHold).where(BookHold.book_id == h.book_id, BookHold.status == "waiting", BookHold.created_at < h.created_at)) or 0
        avail = db.scalar(select(func.count()).select_from(BookCopy).where(BookCopy.book_id == h.book_id, BookCopy.status == "available")) or 0
        holds.append({"id": str(h.id), "title": b.title if b else "?", "ahead": ahead, "ready": ahead == 0 and avail > 0})
    return {"loans": loans_, "holds": holds, "librarian": librarian(db, user, school)}


@router.get("/schools/{school_id}/library/staff")
def staff_search(school_id: uuid.UUID, q: str = Query(min_length=2, max_length=60), user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Staff who can borrow, for the library desk."""
    need_lib(db, user, school_id)
    ids = staff_ids(db, school_id)
    rows = db.scalars(select(User).where(User.id.in_(ids or {uuid.uuid4()}), User.full_name.ilike(f"%{q.strip()}%")).order_by(User.full_name).limit(12))
    nm = Names(db, school_id)
    return [nm.card(u.id) for u in rows]
