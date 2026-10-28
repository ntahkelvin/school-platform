from fastapi import FastAPI

from app.api import auth, schools

app = FastAPI(title="School Platform", version="0.1.0")

app.include_router(auth.router)
app.include_router(schools.router)


@app.get("/api/health", tags=["health"])
def health() -> dict[str, str]:
    return {"status": "ok"}
