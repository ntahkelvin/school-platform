"""All database tables. Importing this module registers every table with Base."""
from app.models.attendance import AttendanceKind, AttendanceRecord, AttendanceStatus
from app.models.academics import AcademicSession, ClassSubject, SchoolClass, StudentElective, Subject, TeachingGroup, Term
from app.models.governance import Board, BoardMember
from app.models.people import BoardingStatus, Gender, Student, StudentGuardian, StudentStatus
from app.models.structure import (
    AssessmentComponent, AssessmentScheme, Bed, Club, ClubKind, Department, DepartmentKind, EventCategory, Facility,
    FacilityKind, GradeBand, GradingScale, Hostel, HostelGender, HostelRoom, House, Period, PeriodKind, Policy,
    SchoolEvent, Section, Unit, Vehicle, VehicleKind,
)
from app.models.staff import EmploymentType, StaffDocument, StaffProfile, StaffQualification
from app.models.growth import Appraisal, CpdRecord, GrowthSettings, Kudos, Mentoring, Observation, Pulse, Strength
from app.models.ops import ClinicVisit, DeskMember, GatePass, Incident, MedicineStock, StudentHealth, Ticket, Visitor
from app.models.logistics import (
    BusRegister, BusRoute, FuelLog, KitchenSettings, MealPlan, MealService, RouteRider, StockItem, StockMove, Trip, VehicleCheck, VehicleService,
)
from app.models.library import (
    Asset, AssetCount, Book, BookCopy, BookHold, CleanArea, CleanDuty, CleanLog, LibrarySettings, Loan,
)
from app.models.rights import AccessGrant, AuditEntry, Notice, RightSetting
from app.models.staffday import DutyAssignment, LeaveRequest, LessonNote, StaffAttendance, StaffDaySettings
from app.models.tenancy import Branch, School, SchoolGroup, SchoolType
from app.models.users import Membership, Role, User

__all__ = [
    "Board", "BoardMember",
    "AssessmentComponent", "AssessmentScheme", "Bed", "Club", "ClubKind", "Department", "DepartmentKind",
    "EventCategory", "Facility", "FacilityKind", "GradeBand", "GradingScale", "Hostel", "HostelGender", "HostelRoom",
    "House", "Period", "PeriodKind", "Policy", "SchoolEvent", "Section", "Unit", "Vehicle", "VehicleKind",
    "AttendanceKind", "AttendanceRecord", "AttendanceStatus",
    "AcademicSession", "ClassSubject", "StudentElective", "TeachingGroup", "SchoolClass", "Subject", "Term",
    "BoardingStatus", "Gender", "Student", "StudentGuardian", "StudentStatus",
    "Branch", "School", "SchoolGroup", "SchoolType",
    "EmploymentType", "StaffDocument", "StaffProfile", "StaffQualification",
    "DutyAssignment", "LeaveRequest", "LessonNote", "StaffAttendance", "StaffDaySettings",
    "Appraisal", "CpdRecord", "GrowthSettings", "Kudos", "Mentoring", "Observation", "Pulse", "Strength",
    "ClinicVisit", "DeskMember", "GatePass", "Incident", "MedicineStock", "StudentHealth", "Ticket", "Visitor",
    "BusRegister", "BusRoute", "FuelLog", "KitchenSettings", "MealPlan", "MealService", "RouteRider", "StockItem", "StockMove", "Trip",
    "VehicleCheck", "VehicleService",
    "AccessGrant", "AuditEntry", "Notice", "RightSetting",
    "Asset", "AssetCount", "Book", "BookCopy", "BookHold", "CleanArea", "CleanDuty", "CleanLog", "LibrarySettings", "Loan",
    "Membership", "Role", "User",
]
