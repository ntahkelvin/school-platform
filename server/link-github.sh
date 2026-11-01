#!/usr/bin/env bash
# Lets the server pull updates from your GitHub repository. Works for public and private repositories.
#   sudo /opt/school-platform/server/link-github.sh
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Run with sudo"; exit 1; }
APP=/opt/school-platform
read -rp "Your repository, as owner/name (for example kelntah/school-platform): " REPO
BRANCH=main
read -rp "Branch [main]: " B; BRANCH=${B:-main}
KEY=/var/lib/school/.ssh/id_ed25519
if git ls-remote "https://github.com/$REPO.git" >/dev/null 2>&1; then
  URL="https://github.com/$REPO.git"
  echo "Public repository: no key needed."
else
  echo "Private repository (or not found): setting up a read-only key."
  sudo -u school mkdir -p /var/lib/school/.ssh
  [ -f "$KEY" ] || sudo -u school ssh-keygen -q -t ed25519 -N "" -C "school-server" -f "$KEY"
  sudo -u school bash -c "ssh-keyscan -q github.com >> /var/lib/school/.ssh/known_hosts 2>/dev/null"
  echo
  echo "1. Open https://github.com/$REPO/settings/keys/new"
  echo "2. Title: School server.   Key: paste the line below.   Leave 'Allow write access' unticked."
  echo
  cat "$KEY.pub"
  echo
  read -rp "3. Press Enter when you have clicked 'Add key'... "
  URL="git@github.com:$REPO.git"
fi
cd "$APP"
[ -d .git ] || sudo -u school git init -q
sudo -u school git remote remove origin 2>/dev/null || true
sudo -u school git remote add origin "$URL"
sudo -u school git fetch -q origin "$BRANCH"
sudo -u school git checkout -q -B "$BRANCH" "origin/$BRANCH" -f
echo "Linked. From now on, update with:  sudo school-update"
