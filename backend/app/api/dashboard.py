"""Figures for the home screen: a few numbers per school, worked out in a handful of queries."""
import uuid
from datetime import date

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from app.api.deps import current_user, owned_group_ids
from app.core.db import get_db
from app.models import (
    AttendanceKind, AttendanceRecord, AttendanceStatus, BoardingStatus, Branch, Department, Gender, Membership, Role,
    School, SchoolClass, Student, StudentStatus, User,
)

router = APIRouter(prefix="/api", tags=["dashboard"])

STAFF_ROLES = [Role.head, Role.bursar, Role.teacher, Role.house_parent, Role.support]


class Today(BaseModel):
    in_classes: int = 0   # active students who are in a class (so on a register)
    marked: int = 0
    present: int = 0      # present or late
    absent: int = 0


class SchoolStats(BaseModel):
    students: int = 0
    boys: int = 0
    girls: int = 0
    boarders: int = 0
    staff: int = 0
    classes: int = 0
    departments: int = 0
    today: Today = Today()


@router.get("/dashboard-stats", response_model=dict[uuid.UUID, SchoolStats])
def dashboard_stats(on_date: date | None = Query(default=None, alias="date"),
                    user: User = Depends(current_user), db: Session = Depends(get_db)):
    groups = owned_group_ids(user)
    if not groups:
        return {}
    day = on_date or date.today()
    school_ids = list(db.scalars(select(School.id).where(School.group_id.in_(groups))))
    stats: dict[uuid.UUID, SchoolStats] = {sid: SchoolStats() for sid in school_ids}
    if not school_ids:
        return stats

    active = (Student.status == StudentStatus.active)
    for sid, total, boys, girls, boarders, in_classes in db.execute(
        select(
            Student.school_id, func.count(),
            func.sum(case((Student.gender == Gender.male, 1), else_=0)),
            func.sum(case((Student.gender == Gender.female, 1), else_=0)),
            func.sum(case((Student.boarding_status == BoardingStatus.boarder, 1), else_=0)),
            func.sum(case((Student.class_id.is_not(None), 1), else_=0)),
        ).where(Student.school_id.in_(school_ids), active).group_by(Student.school_id)
    ):
        s = stats[sid]
        s.students, s.boys, s.girls, s.boarders, s.today.in_classes = total, boys or 0, girls or 0, boarders or 0, in_classes or 0

    for sid, n in db.execute(
        select(Membership.school_id, func.count(func.distinct(Membership.user_id)))
        .where(Membership.school_id.in_(school_ids), Membership.role.in_(STAFF_ROLES)).group_by(Membership.school_id)
    ):
        stats[sid].staff = n

    for sid, n in db.execute(
        select(Branch.school_id, func.count(SchoolClass.id)).join(SchoolClass, SchoolClass.branch_id == Branch.id)
        .where(Branch.school_id.in_(school_ids)).group_by(Branch.school_id)
    ):
        stats[sid].classes = n

    for sid, n in db.execute(
        select(Department.school_id, func.count()).where(Department.school_id.in_(school_ids)).group_by(Department.school_id)
    ):
        stats[sid].departments = n

    for sid, marked, present, absent in db.execute(
        select(
            Student.school_id, func.count(),
            func.sum(case((AttendanceRecord.status.in_([AttendanceStatus.present, AttendanceStatus.late]), 1), else_=0)),
            func.sum(case((AttendanceRecord.status == AttendanceStatus.absent, 1), else_=0)),
        ).join(Student, Student.id == AttendanceRecord.student_id)
        .where(Student.school_id.in_(school_ids), active, AttendanceRecord.on_date == day,
               AttendanceRecord.kind == AttendanceKind.school)
        .group_by(Student.school_id)
    ):
        t = stats[sid].today
        t.marked, t.present, t.absent = marked, present or 0, absent or 0
    return stats
