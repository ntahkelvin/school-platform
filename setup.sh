#!/usr/bin/env bash
# One-time setup. Run from the project folder with:  ./setup.sh
# Safe to run again if something goes wrong part-way.
set -euo pipefail
cd "$(dirname "$0")"

say() { printf "\n\033[1;32m==> %s\033[0m\n" "$1"; }

say "Making sure the database is running"
sudo service postgresql start >/dev/null 2>&1 || true

say "Creating the database user and database (you may be asked for your Linux password)"
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='school'" | grep -q 1; then
  sudo -u postgres psql -qc "CREATE USER school WITH PASSWORD 'school';"
fi
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='school_platform'" | grep -q 1; then
  sudo -u postgres psql -qc "CREATE DATABASE school_platform OWNER school;"
fi

say "Setting up the backend (Python)"
cd backend
[ -d .venv ] || python3 -m venv .venv
.venv/bin/pip install -q --upgrade pip
.venv/bin/pip install -q -r requirements.txt
if [ ! -f .env ]; then
  cp .env.example .env
  secret=$(python3 -c "import secrets; print(secrets.token_urlsafe(48))")
  sed -i "s|^SECRET_KEY=.*|SECRET_KEY=${secret}|" .env
fi
.venv/bin/alembic upgrade head
.venv/bin/python -m app.consolidate
.venv/bin/python -m app.seed
cd ..

say "Setting up the frontend (screens)"
cd frontend
npm install --no-audit --no-fund
cd ..

say "All done! Now run:  ./start.sh"
