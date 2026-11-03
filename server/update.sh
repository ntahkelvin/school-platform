#!/usr/bin/env bash
# Updates the platform to the newest version and keeps your data.
#   sudo school-update                       pull the newest version from GitHub (after link-github.sh)
#   sudo school-update school-platform-x.zip   update from a zip, the way you do on the laptop
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Run with sudo:  sudo school-update"; exit 1; }
APP=/opt/school-platform
say() { printf "\n\033[1;32m==> %s\033[0m\n" "$1"; }

say "Backing up first"
/usr/local/bin/school-backup

if [ -n "${1:-}" ]; then
  say "Unpacking $1"
  TMP=$(mktemp -d); unzip -q -o "$1" -d "$TMP"
  rsync -a --exclude .venv --exclude node_modules --exclude dist --exclude 'backend/.env' --exclude .git "$TMP"/ "$APP"/
  rm -rf "$TMP"
elif [ -d "$APP/.git" ]; then
  say "Getting the newest version from GitHub"
  sudo -u school git -C "$APP" fetch -q origin
  sudo -u school git -C "$APP" reset -q --hard "origin/$(sudo -u school git -C "$APP" rev-parse --abbrev-ref HEAD)"
else
  echo "Give a zip file, or link GitHub first with:  sudo $APP/server/link-github.sh"; exit 1
fi
chown -R school:school "$APP"

say "Backend"
cd "$APP/backend"
sudo -u school .venv/bin/pip install -q -r requirements.txt
sudo -u school .venv/bin/alembic upgrade head
sudo -u school .venv/bin/python -m app.consolidate >/dev/null || true

say "Screens"
cd "$APP/frontend"
sudo -u school bash -c 'export HOME=/var/lib/school
npm config set fetch-retries 6 >/dev/null; npm config set fetch-retry-maxtimeout 120000 >/dev/null
for try in 1 2 3; do npm ci --no-audit --no-fund --loglevel=error && break
  [ $try = 3 ] && { echo "Could not download the screen parts. Check the internet and run this again."; exit 1; }
  echo "Internet hiccup, trying again ($try of 3)..."; sleep 10; done
npm run build > /tmp/school-build.log 2>&1 || { tail -30 /tmp/school-build.log; echo; echo "The screens did not build. Send a screenshot of the lines above."; exit 1; }'

for s in update status backup demo; do ln -sf "$APP/server/$s.sh" /usr/local/bin/school-$s; done
install -m 755 "$APP/server/backup.sh" /usr/local/bin/school-backup
chmod +x "$APP"/server/*.sh
systemctl restart school-api
for i in $(seq 1 20); do curl -s localhost/api/health >/dev/null && break; sleep 1; done
say "Updated: $(sudo -u school git -C "$APP" log -1 --format='%h %s' 2>/dev/null || date)"
