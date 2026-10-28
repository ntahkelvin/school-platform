"""All database tables. Importing this module registers every table with Base."""
from app.models.attendance import AttendanceKind, AttendanceRecord, AttendanceStatus
from app.models.academics import AcademicSession, SchoolClass, Subject, Term
from app.models.governance import Board, BoardMember
from app.models.people import BoardingStatus, Gender, Student, StudentGuardian, StudentStatus
from app.models.structure import (
    AssessmentComponent, AssessmentScheme, Bed, Club, ClubKind, Department, DepartmentKind, EventCategory, Facility,
    FacilityKind, GradeBand, GradingScale, Hostel, HostelGender, HostelRoom, House, Period, PeriodKind, Policy,
    SchoolEvent, Section, Vehicle, VehicleKind,
)
from app.models.tenancy import Branch, School, SchoolGroup, SchoolType
from app.models.users import Membership, Role, User

__all__ = [
    "Board", "BoardMember",
    "AssessmentComponent", "AssessmentScheme", "Bed", "Club", "ClubKind", "Department", "DepartmentKind",
    "EventCategory", "Facility", "FacilityKind", "GradeBand", "GradingScale", "Hostel", "HostelGender", "HostelRoom",
    "House", "Period", "PeriodKind", "Policy", "SchoolEvent", "Section", "Vehicle", "VehicleKind",
    "AttendanceKind", "AttendanceRecord", "AttendanceStatus",
    "AcademicSession", "SchoolClass", "Subject", "Term",
    "BoardingStatus", "Gender", "Student", "StudentGuardian", "StudentStatus",
    "Branch", "School", "SchoolGroup", "SchoolType",
    "Membership", "Role", "User",
]
