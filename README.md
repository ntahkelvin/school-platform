# School Platform

One platform to run a school or school group: records, attendance, results, fees,
boarding and welfare, parents, tuck shop and visual lessons.

Working name; the brand name is still to be chosen.

## First time on a new computer

```bash
./setup.sh
```

## Every time you want to work on it

```bash
./start.sh
```

Then open http://localhost:5173 and log in with:

- Email: `owner@demo.local`
- Password: `ChangeMe123!`

Press Ctrl + C in the terminal to stop.

## What's inside

| Folder | What it is |
|---|---|
| `backend/` | The brain: Python (FastAPI) and the PostgreSQL database |
| `backend/app/models/` | The database tables |
| `backend/app/api/` | The things the screens can ask the brain to do |
| `backend/alembic/versions/` | Step-by-step changes to the database tables |
| `frontend/` | The screens people see (React) |

Backend API documentation: http://localhost:8000/docs (while running).

## Progress

- [x] Week 1: login, roles, school group > school > branch
- [x] Week 2: students, staff, families, sessions, terms, classes, subjects, editing schools and branches
- [ ] Week 3: attendance (works offline)
- [ ] Week 4: scores and report cards
- [ ] Week 5: fees ledger
- [ ] Week 6: parent app with child switcher
- [ ] Week 7: permissions and owner dashboard
- [ ] Week 8: testing and hosting
