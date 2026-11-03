"""All database tables. Importing this module registers every table with Base."""
from app.models.attendance import AttendanceKind, AttendanceRecord, AttendanceStatus
from app.models.portal import ClubRequest, Concern, Enrolment, ReadingEntry, StudentGoal, SubjectChoice, SubjectChoiceWindow
from app.models.academics import AcademicSession, ClassSubject, SchoolClass, StudentElective, Subject, TeachingGroup, Term, TimetableSettings, TimetableSlot, TimetableGroupSlot, CoverLesson
from app.models.governance import Board, BoardMember
from app.models.people import (
    BoardingStatus, ConductEntry, Gender, Student, StudentAward, StudentClub, StudentContact, StudentDocument, StudentEvent, StudentGuardian,
    StudentNote, StudentStatus, PromotionRun, FamilySettings, FamilyNote, AdmissionSettings, Application, ApplicationDoc, ProfileRequest,
)
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

from app.models.assessment import (AssessmentWindow, Assignment, ComponentRelease, ReportCard, ResultSettings, Score, ScoreBookEntry, ScoreCheck, SheetStatus, SheetStep, Submission,
                                   WindowOpening)

__all__ = [
    "Assignment", "ReportCard", "Score", "SheetStatus", "Submission", "AssessmentWindow", "ComponentRelease", "ResultSettings", "SheetStep", "WindowOpening", "ScoreBookEntry", "ScoreCheck",
    "Board", "BoardMember",
    "AssessmentComponent", "AssessmentScheme", "Bed", "Club", "ClubKind", "Department", "DepartmentKind",
    "EventCategory", "Facility", "FacilityKind", "GradeBand", "GradingScale", "Hostel", "HostelGender", "HostelRoom",
    "House", "Period", "PeriodKind", "Policy", "SchoolEvent", "Section", "Unit", "Vehicle", "VehicleKind",
    "AttendanceKind", "AttendanceRecord", "AttendanceStatus",
    "AcademicSession", "ClassSubject", "StudentElective", "TeachingGroup", "SchoolClass", "Subject", "Term", "TimetableSettings", "TimetableSlot", "TimetableGroupSlot", "CoverLesson",
    "BoardingStatus", "ConductEntry", "Gender", "Student", "StudentAward", "StudentClub", "StudentContact", "StudentDocument", "StudentEvent",
    "StudentGuardian", "StudentNote", "StudentStatus", "PromotionRun", "FamilySettings", "FamilyNote", "AdmissionSettings", "Application", "ApplicationDoc", "ProfileRequest", "ClubRequest", "Concern", "ReadingEntry", "StudentGoal", "Enrolment", "SubjectChoice", "SubjectChoiceWindow",
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
