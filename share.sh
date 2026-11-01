#!/usr/bin/env bash
# Shares the platform with your phones and other computers through a secure https link.
# Works on Wi-Fi or mobile data, anywhere. Press Ctrl + C to stop: the link stops working at once.
set -euo pipefail
cd "$(dirname "$0")"

# 1. Install the free Cloudflare tunnel tool and a QR code maker the first time
if ! command -v cloudflared >/dev/null; then
  echo "Installing cloudflared (one time only)..."
  curl -fsSL -o /tmp/cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
  sudo dpkg -i /tmp/cloudflared.deb >/dev/null
fi
command -v qrencode >/dev/null || sudo apt-get install -y qrencode >/dev/null 2>&1 || true

sudo service postgresql start >/dev/null 2>&1 || true

# 2. Build the screens once (much faster on phones than the development server)
echo "Building the app..."
(cd frontend && npm run build >/dev/null)

# 3. Start the backend and the finished app
(cd backend && .venv/bin/uvicorn app.main:app --port 8000 >/tmp/sp-backend.log 2>&1) &
BACK=$!
(cd frontend && npx vite preview --port 4173 >/tmp/sp-app.log 2>&1) &
APP=$!
trap 'kill $BACK $APP $TUN 2>/dev/null; echo; echo "Stopped. The link no longer works."' EXIT
for i in $(seq 1 30); do curl -s localhost:4173 >/dev/null && curl -s localhost:8000/api/health >/dev/null && break; sleep 1; done

# 4. Open the tunnel and show the link
cloudflared tunnel --no-autoupdate --url http://localhost:4173 >/tmp/sp-tunnel.log 2>&1 &
TUN=$!
URL=""
for i in $(seq 1 40); do
  URL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' /tmp/sp-tunnel.log | grep -v '//api\.' | head -1 || true)
  [ -n "$URL" ] && break
  sleep 1
done
if [ -z "$URL" ]; then echo "Could not open the link. Check your internet, then see /tmp/sp-tunnel.log"; exit 1; fi

echo
printf "\033[1;32mYour platform is live at:\033[0m\n\n    \033[1;36m%s\033[0m\n\n" "$URL"
command -v qrencode >/dev/null && qrencode -t ansiutf8 "$URL" && echo "Scan this with a phone camera to open it."
echo
echo "The link changes each time you run this. Keep this window open; press Ctrl + C to stop sharing."
wait $TUN
