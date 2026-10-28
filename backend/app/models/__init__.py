"""All database tables. Importing this module registers every table with Base."""
from app.models.academics import AcademicSession, SchoolClass, Subject, Term
from app.models.people import BoardingStatus, Gender, Student, StudentGuardian, StudentStatus
from app.models.tenancy import Branch, School, SchoolGroup, SchoolType
from app.models.users import Membership, Role, User

__all__ = [
    "AcademicSession", "SchoolClass", "Subject", "Term",
    "BoardingStatus", "Gender", "Student", "StudentGuardian", "StudentStatus",
    "Branch", "School", "SchoolGroup", "SchoolType",
    "Membership", "Role", "User",
]
