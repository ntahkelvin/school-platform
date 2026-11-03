#!/usr/bin/env bash
# Installs the school platform on a fresh Ubuntu Server 24.04 machine (for example a Proxmox VM).
#
#   sudo ./server/install.sh                          a fresh, empty platform
#   sudo ./server/install.sh laptop-data.sql.gz       bring your laptop's data across
#
# Safe to run again. It sets up: the database, the backend, the screens, the Caddy web server,
# start-on-boot services, nightly backups and a free https link through Tailscale Funnel.
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Run with sudo:  sudo ./server/install.sh"; exit 1; }
SRC="$(cd "$(dirname "$0")/.." && pwd)"
APP=/opt/school-platform
DATA="${1:-}"
say() { printf "\n\033[1;32m==> %s\033[0m\n" "$1"; }

say "1/9 Installing the building blocks (takes a few minutes the first time)"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq postgresql python3-venv python3-pip caddy git curl rsync unzip qrencode >/dev/null
if ! command -v node >/dev/null || [ "$(node -v | cut -c2- | cut -d. -f1)" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi

say "2/9 Copying the platform to $APP"
id school >/dev/null 2>&1 || useradd --system --create-home --home-dir /var/lib/school --shell /usr/sbin/nologin school
mkdir -p "$APP"
if [ "$SRC" != "$APP" ]; then
  rsync -a --delete --exclude .venv --exclude node_modules --exclude dist --exclude 'backend/.env' --exclude .git "$SRC"/ "$APP"/
fi
chown -R school:school "$APP"

say "3/9 Setting up the database"
systemctl enable --now postgresql >/dev/null
if [ ! -f "$APP/backend/.env" ]; then
  DBPASS=$(python3 -c "import secrets; print(secrets.token_urlsafe(24))")
  SECRET=$(python3 -c "import secrets; print(secrets.token_urlsafe(48))")
  cat > "$APP/backend/.env" <<ENV
DATABASE_URL=postgresql+psycopg://school:${DBPASS}@localhost:5432/school_platform
SECRET_KEY=${SECRET}
ACCESS_TOKEN_MINUTES=720
ENV
  chown school:school "$APP/backend/.env"; chmod 600 "$APP/backend/.env"
  if sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='school'" | grep -q 1; then
    sudo -u postgres psql -qc "ALTER USER school WITH PASSWORD '${DBPASS}';"
  else
    sudo -u postgres psql -qc "CREATE USER school WITH PASSWORD '${DBPASS}';"
  fi
fi
FRESH=0
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='school_platform'" | grep -q 1; then
  sudo -u postgres psql -qc "CREATE DATABASE school_platform OWNER school;"
  FRESH=1
fi
if [ -n "$DATA" ]; then
  say "   Bringing in your data from $DATA"
  systemctl stop school-api 2>/dev/null || true
  sudo -u postgres psql -qc "DROP DATABASE school_platform WITH (FORCE);"
  sudo -u postgres psql -qc "CREATE DATABASE school_platform OWNER school;"
  if [[ "$DATA" == *.gz ]]; then gunzip -c "$DATA"; else cat "$DATA"; fi | sudo -u postgres psql -q -d school_platform >/dev/null
  sudo -u postgres psql -q -d school_platform -c "REASSIGN OWNED BY postgres TO school;" >/dev/null 2>&1 || true
  sudo -u postgres psql -q -d school_platform -c "GRANT ALL ON SCHEMA public TO school; GRANT ALL ON ALL TABLES IN SCHEMA public TO school; GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO school;" >/dev/null
  FRESH=0
fi

say "4/9 Setting up the backend"
cd "$APP/backend"
sudo -u school bash -c "[ -d .venv ] || python3 -m venv .venv; .venv/bin/pip install -q --upgrade pip; .venv/bin/pip install -q -r requirements.txt"
sudo -u school .venv/bin/alembic upgrade head
sudo -u school .venv/bin/python -m app.consolidate >/dev/null || true

if [ "$FRESH" = 1 ]; then
  say "   Create the owner (proprietor) login"
  read -rp "   Your full name: " ONAME
  read -rp "   Your email (this is your username): " OEMAIL
  read -rp "   Name of your group of schools: " OGROUP
  while true; do
    read -rsp "   Choose a password (8 or more characters): " OPASS; echo
    read -rsp "   Type it again: " OPASS2; echo
    [ "$OPASS" = "$OPASS2" ] && [ ${#OPASS} -ge 8 ] && break
    echo "   They don't match or it's too short. Try again."
  done
  sudo -u school env OWNER_PASSWORD="$OPASS" .venv/bin/python -m app.make_owner "$ONAME" "$OEMAIL" "$OGROUP"
fi

say "5/9 Building the screens"
cd "$APP/frontend"
sudo -u school bash -c 'export HOME=/var/lib/school
npm config set fetch-retries 6 >/dev/null; npm config set fetch-retry-maxtimeout 120000 >/dev/null
for try in 1 2 3; do npm ci --no-audit --no-fund --loglevel=error && break
  [ $try = 3 ] && { echo "Could not download the screen parts. Check the internet and run this again."; exit 1; }
  echo "Internet hiccup, trying again ($try of 3)..."; sleep 10; done
npm run build > /tmp/school-build.log 2>&1 || { tail -30 /tmp/school-build.log; echo; echo "The screens did not build. Send a screenshot of the lines above."; exit 1; }'

say "6/9 Start-on-boot service for the backend"
cat > /etc/systemd/system/school-api.service <<UNIT
[Unit]
Description=School platform backend
After=network.target postgresql.service
Requires=postgresql.service

[Service]
User=school
WorkingDirectory=$APP/backend
ExecStart=$APP/backend/.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 2 --proxy-headers
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable school-api >/dev/null
systemctl restart school-api

say "7/9 Web server (Caddy)"
cat > /etc/caddy/Caddyfile <<CADDY
# The school platform. Tailscale Funnel gives it https; on the home network use http://<this machine's IP>
:80 {
	encode gzip
	request_body {
		max_size 25MB
	}
	handle /api/* {
		reverse_proxy 127.0.0.1:8000
	}
	handle {
		root * $APP/frontend/dist
		try_files {path} /index.html
		file_server
	}
}
CADDY
systemctl enable caddy >/dev/null
systemctl restart caddy

say "8/9 Nightly backups (kept for 14 days in /var/backups/school-platform)"
install -m 755 "$APP/server/backup.sh" /usr/local/bin/school-backup
echo "30 2 * * * root /usr/local/bin/school-backup >/dev/null 2>&1" > /etc/cron.d/school-backup
for s in update status backup demo; do ln -sf "$APP/server/$s.sh" /usr/local/bin/school-$s; done
chmod +x "$APP"/server/*.sh

say "9/9 Free https link with Tailscale Funnel"
if ! command -v tailscale >/dev/null; then curl -fsSL https://tailscale.com/install.sh | sh >/dev/null; fi
if ! tailscale status >/dev/null 2>&1; then
  echo "   Log in to Tailscale: open the link below on any device and sign in (Google, Microsoft, GitHub or Apple)."
  tailscale up --hostname=school
fi
if ! tailscale funnel --bg 80; then
  echo
  echo "   Tailscale needs you to allow Funnel once. Open the link shown above, click Enable, then run:"
  echo "       sudo tailscale funnel --bg 80"
fi

for i in $(seq 1 20); do curl -s localhost/api/health >/dev/null && break; sleep 1; done
echo
/usr/local/bin/school-status
