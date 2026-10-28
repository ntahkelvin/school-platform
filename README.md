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

## Testing offline

`./start.sh` is the development version, where offline saving works but the page itself
needs the server to load. To try the finished version that also opens with no internet:

```bash
cd frontend && npm run build && npm run preview
```

Keep `./start.sh` running in another terminal for the backend, then open http://localhost:4173.

Backend API documentation: http://localhost:8000/docs (while running).

## Progress

- [x] Week 1: login, roles, school group > school > branch
- [x] Week 2: students, staff, families, sessions, terms, classes, subjects, editing schools and branches
- [x] Week 3: attendance registers and night roll call, working offline
- [ ] Week 4: scores and report cards
- [ ] Week 5: fees ledger
- [ ] Week 6: parent app with child switcher
- [ ] Week 7: permissions and owner dashboard
- [ ] Week 8: testing and hosting
