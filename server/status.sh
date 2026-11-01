#!/usr/bin/env bash
# Shows whether everything is running, and the link to open on phones.
ok() { systemctl is-active --quiet "$1" && printf "  \033[32m●\033[0m %s\n" "$2" || printf "  \033[31m●\033[0m %s (not running: sudo systemctl restart %s)\n" "$2" "$1"; }
echo "School platform"
ok postgresql "Database"
ok school-api "Backend"
ok caddy "Web server"
curl -s localhost/api/health | grep -q ok && printf "  \033[32m●\033[0m App answering\n" || printf "  \033[31m●\033[0m App not answering\n"
IP=$(hostname -I | awk '{print $1}')
echo
echo "  On your home network:  http://$IP"
URL=$(tailscale funnel status 2>/dev/null | grep -oE 'https://[^ ]+' | head -1 | sed 's:/$::')
if [ -n "$URL" ]; then
  printf "  Anywhere (phones):     \033[1;36m%s\033[0m\n\n" "$URL"
  command -v qrencode >/dev/null && qrencode -t ansiutf8 "$URL"
else
  echo "  Anywhere: Tailscale Funnel is not on yet. Run:  sudo tailscale funnel --bg 80"
fi
LAST=$(ls -t /var/backups/school-platform/*.sql.gz 2>/dev/null | head -1)
echo "  Last backup: ${LAST:-none yet}"
