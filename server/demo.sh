#!/usr/bin/env bash
# Sample data for trying new parts of the platform.
#   sudo bash /opt/school-platform/server/demo.sh results                 scores, homework and report cards for one class
#   sudo bash /opt/school-platform/server/demo.sh results "Jesuit" "JSS 2C"
#   sudo bash /opt/school-platform/server/demo.sh discipline "Jesuit"      reports at every stage: POD, principal, house master
[ "$(id -u)" = 0 ] || { echo "Run with sudo"; exit 1; }
cd /opt/school-platform/backend && sudo -u school .venv/bin/python -m app.demo "$@"
