"""All database tables. Importing this module registers every table with Base."""
from app.models.tenancy import Branch, School, SchoolGroup, SchoolType
from app.models.users import Membership, Role, User

__all__ = ["Branch", "School", "SchoolGroup", "SchoolType", "Membership", "Role", "User"]
