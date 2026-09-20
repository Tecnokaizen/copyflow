#!/usr/bin/env bash
# Orchestrates Gestcopy platform backups for Coolify Scheduled Tasks.
# B1.2: Files only. B1.3 can insert backup-database.sh before/after without redesign.
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "backup-all: start ${STARTED_AT} UTC"

# --- Files (B1.2) ---
"${SCRIPT_DIR}/backup-files.sh"

# --- Database (B1.3 placeholder) ---
# "${SCRIPT_DIR}/backup-database.sh"

FINISHED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "backup-all: finished ${FINISHED_AT} UTC"
echo "BACKUP_ALL_SUCCESS"
