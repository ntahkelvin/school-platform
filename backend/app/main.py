from fastapi import FastAPI

from app.api import academics, attendance, auth, boards, dashboard, imports, logins, organisations, schools, staff, starter, structure, students, teaching, units, electives, portal, staff_records, staff_day, growth, ops, logistics, rights, library, cleaning, assets, student360, student_year, family, admissions, timetable, profiles, student_portal, records, assessment, checks, scorebook, analytics

app = FastAPI(title="School Platform", version="0.1.0")

app.include_router(auth.router)
app.include_router(schools.router)
app.include_router(academics.router)
app.include_router(students.router)
app.include_router(staff.router)
app.include_router(attendance.router)
app.include_router(structure.router)
app.include_router(starter.router)
app.include_router(organisations.router)
app.include_router(boards.router)
app.include_router(dashboard.router)
app.include_router(imports.router)
app.include_router(logins.router)
app.include_router(teaching.router)
app.include_router(units.router)
app.include_router(electives.router)
app.include_router(portal.router)
app.include_router(staff_records.router)
app.include_router(staff_day.router)
app.include_router(growth.router)
app.include_router(ops.router)
app.include_router(logistics.router)
app.include_router(rights.router)
app.include_router(library.router)
app.include_router(cleaning.router)
app.include_router(assets.router)
app.include_router(student360.router)
app.include_router(student_year.router)
app.include_router(family.router)
app.include_router(admissions.router)
app.include_router(timetable.router)
app.include_router(profiles.router)
app.include_router(student_portal.router)
app.include_router(records.router)
app.include_router(assessment.router)
app.include_router(checks.router)
app.include_router(scorebook.router)
app.include_router(analytics.router)


@app.get("/api/health", tags=["health"])
def health() -> dict[str, str]:
    return {"status": "ok"}
