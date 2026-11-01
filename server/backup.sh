#!/usr/bin/env bash
# Saves the whole database to /var/backups/school-platform. Runs every night at 2:30 am; keeps 14 days.
set -euo pipefail
DIR=/var/backups/school-platform
mkdir -p "$DIR"
F="$DIR/school-$(date +%Y-%m-%d-%H%M).sql.gz"
sudo -u postgres pg_dump --no-owner school_platform | gzip > "$F"
find "$DIR" -name 'school-*.sql.gz' -mtime +14 -delete
echo "Backup saved: $F ($(du -h "$F" | cut -f1))"
