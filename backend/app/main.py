from fastapi import FastAPI

from app.api import academics, attendance, auth, boards, dashboard, imports, organisations, schools, staff, starter, structure, students

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


@app.get("/api/health", tags=["health"])
def health() -> dict[str, str]:
    return {"status": "ok"}
