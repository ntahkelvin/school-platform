"""Boards (trustees, directors, governors), their members, and the read-only board view."""
import uuid
from collections import Counter
from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.access import not_found, owned_group, owned_school
from app.api.deps import current_user, owned_group_ids
from app.api.people import find_or_create_user
from app.core.db import get_db
from app.models import (
    AttendanceKind, AttendanceRecord, AttendanceStatus, Board, BoardMember, BoardingStatus, Gender, Membership, Role,
    School, SchoolEvent, SchoolGroup, Section, Student, StudentStatus, User,
)

router = APIRouter(prefix="/api", tags=["boards"])

POSITIONS = ["Chairman", "Vice Chairman", "Secretary", "Treasurer", "Trustee", "Director", "Member", "Ex-officio member"]


def bad(msg: str) -> HTTPException:
    return HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, msg)


class MemberOut(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    full_name: str
    phone: str | None
    email: str | None
    position: str
    term_start: date | None
    term_end: date | None


class BoardOut(BaseModel):
    id: uuid.UUID
    name: str
    school_id: uuid.UUID | None
    members: list[MemberOut]


def _out(b: Board) -> BoardOut:
    return BoardOut(id=b.id, name=b.name, school_id=b.school_id, members=[
        MemberOut(id=m.id, user_id=m.user_id, full_name=m.user.full_name, phone=m.user.phone, email=m.user.email,
                  position=m.position, term_start=m.term_start, term_end=m.term_end) for m in b.members])


class BoardIn(BaseModel):
    name: str = Field(min_length=2, max_length=100)


@router.get("/board-positions", response_model=list[str])
def board_positions() -> list[str]:
    return POSITIONS


@router.get("/groups/{group_id}/boards", response_model=list[BoardOut])
def organisation_boards(group_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    owned_group(db, user, group_id)
    return [_out(b) for b in db.scalars(select(Board).where(Board.group_id == group_id, Board.school_id.is_(None)).order_by(Board.name))]


@router.post("/groups/{group_id}/boards", response_model=BoardOut, status_code=201)
def add_organisation_board(group_id: uuid.UUID, data: BoardIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    owned_group(db, user, group_id)
    b = Board(group_id=group_id, name=data.name.strip())
    db.add(b)
    db.commit()
    db.refresh(b)
    return _out(b)


@router.get("/schools/{school_id}/boards", response_model=list[BoardOut])
def school_boards(school_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    owned_school(db, user, school_id)
    return [_out(b) for b in db.scalars(select(Board).where(Board.school_id == school_id).order_by(Board.name))]


@router.post("/schools/{school_id}/boards", response_model=BoardOut, status_code=201)
def add_school_board(school_id: uuid.UUID, data: BoardIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    school = owned_school(db, user, school_id)
    b = Board(group_id=school.group_id, school_id=school.id, name=data.name.strip())
    db.add(b)
    db.commit()
    db.refresh(b)
    return _out(b)


def _own_board(db: Session, user: User, board_id: uuid.UUID) -> Board:
    b = db.get(Board, board_id)
    if not b or b.group_id not in owned_group_ids(user):
        raise not_found("Board")
    return b


@router.patch("/boards/{board_id}", response_model=BoardOut)
def rename_board(board_id: uuid.UUID, data: BoardIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    b = _own_board(db, user, board_id)
    b.name = data.name.strip()
    db.commit()
    db.refresh(b)
    return _out(b)


def _board_role_still_needed(db: Session, user_id: uuid.UUID, group_id: uuid.UUID, school_id: uuid.UUID | None) -> bool:
    return bool(db.scalar(
        select(BoardMember.id).join(Board).where(
            BoardMember.user_id == user_id, Board.group_id == group_id,
            Board.school_id.is_(None) if school_id is None else Board.school_id == school_id)))


def _drop_board_role_if_unused(db: Session, user_id: uuid.UUID, group_id: uuid.UUID, school_id: uuid.UUID | None) -> None:
    if _board_role_still_needed(db, user_id, group_id, school_id):
        return
    q = select(Membership).where(Membership.user_id == user_id, Membership.role == Role.board_member,
                                 Membership.group_id == group_id)
    q = q.where(Membership.school_id.is_(None)) if school_id is None else q.where(Membership.school_id == school_id)
    for m in db.scalars(q):
        db.delete(m)


@router.delete("/boards/{board_id}", status_code=204)
def delete_board(board_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    b = _own_board(db, user, board_id)
    people = [(m.user_id) for m in b.members]
    group_id, school_id = b.group_id, b.school_id
    db.delete(b)
    db.flush()
    for uid in people:
        _drop_board_role_if_unused(db, uid, group_id, school_id)
    db.commit()
    return Response(status_code=204)


class MemberIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    full_name: str = Field(min_length=2, max_length=200)
    phone: str | None = None
    email: str | None = None
    position: str = Field(min_length=2, max_length=50)
    term_start: date | None = None
    term_end: date | None = None

    @model_validator(mode="after")
    def check_terms(self) -> "MemberIn":
        if self.term_start and self.term_end and self.term_end < self.term_start:
            raise ValueError("The term of office can't end before it starts")
        return self


class MemberUpdate(BaseModel):
    position: str = Field(min_length=2, max_length=50)
    term_start: date | None = None
    term_end: date | None = None

    @model_validator(mode="after")
    def check_terms(self) -> "MemberUpdate":
        if self.term_start and self.term_end and self.term_end < self.term_start:
            raise ValueError("The term of office can't end before it starts")
        return self


def _order(position: str) -> int:
    try:
        return POSITIONS.index(position)
    except ValueError:
        return len(POSITIONS)


class MemberAdded(BaseModel):
    board: BoardOut
    new_login: dict | None


@router.post("/boards/{board_id}/members", response_model=MemberAdded, status_code=201)
def add_member(board_id: uuid.UUID, data: MemberIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    b = _own_board(db, user, board_id)
    person, password = find_or_create_user(db, data.full_name, data.phone, data.email)
    if any(m.user_id == person.id for m in b.members):
        raise HTTPException(status.HTTP_409_CONFLICT, f"{person.full_name} is already on this board")
    b.members.append(BoardMember(user_id=person.id, position=data.position, position_order=_order(data.position),
                                 term_start=data.term_start, term_end=data.term_end))
    has_role = db.scalar(select(Membership.id).where(
        Membership.user_id == person.id, Membership.role == Role.board_member, Membership.group_id == b.group_id,
        Membership.school_id.is_(None) if b.school_id is None else Membership.school_id == b.school_id))
    if not has_role:
        db.add(Membership(user_id=person.id, role=Role.board_member, group_id=b.group_id, school_id=b.school_id))
    db.commit()
    db.refresh(b)
    login = {"name": person.full_name, "username": person.phone or person.email, "password": password} if password else None
    return MemberAdded(board=_out(b), new_login=login)


def _own_member(db: Session, user: User, member_id: uuid.UUID) -> BoardMember:
    m = db.get(BoardMember, member_id)
    if not m:
        raise not_found("Board member")
    _own_board(db, user, m.board_id)
    return m


@router.patch("/board-members/{member_id}", response_model=BoardOut)
def update_member(member_id: uuid.UUID, data: MemberUpdate, user: User = Depends(current_user), db: Session = Depends(get_db)):
    m = _own_member(db, user, member_id)
    m.position, m.position_order = data.position.strip(), _order(data.position.strip())
    m.term_start, m.term_end = data.term_start, data.term_end
    db.commit()
    b = db.get(Board, m.board_id)
    db.refresh(b)
    return _out(b)


@router.delete("/board-members/{member_id}", response_model=BoardOut)
def remove_member(member_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    m = _own_member(db, user, member_id)
    b = db.get(Board, m.board_id)
    uid = m.user_id
    b.members.remove(m)
    db.flush()
    _drop_board_role_if_unused(db, uid, b.group_id, b.school_id)
    db.commit()
    db.refresh(b)
    return _out(b)


# ======================= The board view (read only) =======================

class StaffCount(BaseModel):
    role: str
    count: int


class SchoolSummary(BaseModel):
    id: uuid.UUID
    name: str
    logo: str | None
    motto: str | None
    school_type: str
    branches: int
    students: int
    boys: int
    girls: int
    boarders: int
    by_section: dict[str, int]
    staff_total: int
    staff: list[StaffCount]
    attendance_rate_30d: float | None
    upcoming: list[dict]
    boards: list[BoardOut]


class OrganisationSummary(BaseModel):
    id: uuid.UUID
    name: str
    logo: str | None
    is_owner: bool
    boards: list[BoardOut]
    schools: list[SchoolSummary]
    totals: dict[str, int]


STAFF_ROLES = [Role.head, Role.bursar, Role.teacher, Role.house_parent]
ROLE_LABEL = {Role.head: "Heads", Role.bursar: "Bursars", Role.teacher: "Teachers", Role.house_parent: "House parents"}


def _school_summary(db: Session, school: School, include_boards: bool) -> SchoolSummary:
    students = list(db.scalars(select(Student).where(Student.school_id == school.id, Student.status == StudentStatus.active)).unique())
    sections = list(db.scalars(select(Section).where(Section.school_id == school.id).order_by(Section.position)))
    level_to_section = {lv: s.name for s in sections for lv in (s.levels or [])}
    by_section: Counter[str] = Counter()
    for s in students:
        lvl = s.school_class.level if s.school_class else None
        by_section[level_to_section.get(lvl, "No class / other") if lvl else "No class / other"] += 1

    staff_rows = db.execute(
        select(Membership.role, func.count(func.distinct(Membership.user_id)))
        .where(Membership.school_id == school.id, Membership.role.in_(STAFF_ROLES)).group_by(Membership.role)).all()
    staff_people = db.scalar(select(func.count(func.distinct(Membership.user_id))).where(
        Membership.school_id == school.id, Membership.role.in_(STAFF_ROLES))) or 0

    since = date.today() - timedelta(days=29)
    tally = Counter(st.value for st in db.scalars(
        select(AttendanceRecord.status).join(Student, Student.id == AttendanceRecord.student_id).where(
            Student.school_id == school.id, AttendanceRecord.kind == AttendanceKind.school,
            AttendanceRecord.on_date >= since)))
    countable = sum(tally.values()) - tally[AttendanceStatus.excused.value]
    rate = round(100 * (tally["present"] + tally["late"]) / countable, 1) if countable else None

    upcoming = [
        {"title": e.title, "category": e.category.value, "starts_on": e.starts_on.isoformat(),
         "ends_on": e.ends_on.isoformat() if e.ends_on else None}
        for e in db.scalars(select(SchoolEvent).where(SchoolEvent.school_id == school.id, SchoolEvent.starts_on >= date.today())
                            .order_by(SchoolEvent.starts_on).limit(5))
    ]
    boards = [_out(b) for b in db.scalars(select(Board).where(Board.school_id == school.id).order_by(Board.name))] if include_boards else []
    return SchoolSummary(
        id=school.id, name=school.name, logo=school.logo, motto=school.motto, school_type=school.school_type.value,
        branches=len(school.branches), students=len(students),
        boys=sum(1 for s in students if s.gender == Gender.male), girls=sum(1 for s in students if s.gender == Gender.female),
        boarders=sum(1 for s in students if s.boarding_status == BoardingStatus.boarder),
        by_section=dict(by_section), staff_total=staff_people,
        staff=[StaffCount(role=ROLE_LABEL[r], count=n) for r, n in sorted(staff_rows, key=lambda x: STAFF_ROLES.index(x[0]))],
        attendance_rate_30d=rate, upcoming=upcoming, boards=boards,
    )


@router.get("/board/overview", response_model=list[OrganisationSummary])
def board_overview(user: User = Depends(current_user), db: Session = Depends(get_db)):
    """What a board member (or owner) sees: whole organisations, or just their own school."""
    owner_of = owned_group_ids(user)
    org_board = {m.group_id for m in user.memberships if m.role == Role.board_member and m.school_id is None}
    school_board = {m.school_id for m in user.memberships if m.role == Role.board_member and m.school_id is not None}

    result: list[OrganisationSummary] = []
    group_ids = owner_of | org_board | {db.get(School, sid).group_id for sid in school_board if db.get(School, sid)}
    for gid in sorted(group_ids, key=str):
        group = db.get(SchoolGroup, gid)
        whole = gid in owner_of or gid in org_board
        schools = [s for s in sorted(group.schools, key=lambda s: s.name) if whole or s.id in school_board]
        summaries = [_school_summary(db, s, include_boards=True) for s in schools]
        result.append(OrganisationSummary(
            id=group.id, name=group.name, logo=group.logo, is_owner=gid in owner_of,
            boards=[_out(b) for b in db.scalars(select(Board).where(Board.group_id == gid, Board.school_id.is_(None)))] if whole else [],
            schools=summaries,
            totals={
                "schools": len(summaries),
                "students": sum(s.students for s in summaries),
                "boarders": sum(s.boarders for s in summaries),
                "staff": sum(s.staff_total for s in summaries),
            },
        ))
    return sorted(result, key=lambda o: o.name.lower())
