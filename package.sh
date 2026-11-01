#!/usr/bin/env bash
# Developer helper: write the file list and make the zip.  ./package.sh name
set -e; cd "$(dirname "$0")"
git ls-files | grep -vx .manifest | sort > .manifest; echo .manifest >> .manifest
git add .manifest; git diff --cached --quiet || git commit -qm "Update file list"
git archive --format=zip -o "../school-platform-$1.zip" HEAD
