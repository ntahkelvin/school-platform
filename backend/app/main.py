from fastapi import FastAPI

from app.api import academics, auth, schools, staff, students

app = FastAPI(title="School Platform", version="0.1.0")

app.include_router(auth.router)
app.include_router(schools.router)
app.include_router(academics.router)
app.include_router(students.router)
app.include_router(staff.router)


@app.get("/api/health", tags=["health"])
def health() -> dict[str, str]:
    return {"status": "ok"}
