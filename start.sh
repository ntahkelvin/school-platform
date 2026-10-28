#!/usr/bin/env bash
# Starts the backend and the screens together. Press Ctrl + C to stop both.
set -euo pipefail
cd "$(dirname "$0")"

sudo service postgresql start >/dev/null 2>&1 || true

(cd backend && .venv/bin/uvicorn app.main:app --reload --port 8000) &
BACKEND_PID=$!
trap 'kill $BACKEND_PID 2>/dev/null' EXIT

printf "\n\033[1;32mOpen http://localhost:5173 in your browser. Press Ctrl + C here to stop.\033[0m\n\n"
cd frontend && npm run dev
