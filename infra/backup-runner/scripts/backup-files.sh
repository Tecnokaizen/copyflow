#!/usr/bin/env bash
# Copy Gestcopy Files from Cloudflare R2 → Backblaze B2 (additive, never sync/delete).
set -Eeuo pipefail

require_var() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "ERROR: required environment variable ${name} is missing or empty" >&2
    exit 1
  fi
}

require_var RCLONE_CONFIG_R2_TYPE
require_var RCLONE_CONFIG_R2_PROVIDER
require_var RCLONE_CONFIG_R2_ACCESS_KEY_ID
require_var RCLONE_CONFIG_R2_SECRET_ACCESS_KEY
require_var RCLONE_CONFIG_R2_ENDPOINT
require_var RCLONE_CONFIG_B2_TYPE
require_var RCLONE_CONFIG_B2_ACCOUNT
require_var RCLONE_CONFIG_B2_KEY
require_var GESTCOPY_R2_BUCKET
require_var GESTCOPY_B2_BUCKET
require_var GESTCOPY_B2_FILES_PREFIX

# Non-secret defaults that may still be overridden by the environment.
: "${RCLONE_CONFIG_R2_REGION:=auto}"
: "${RCLONE_CONFIG_R2_NO_CHECK_BUCKET:=true}"
: "${RCLONE_CONFIG_B2_HARD_DELETE:=false}"

STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "backup-files: start ${STARTED_AT} UTC"
echo "backup-files: source R2:${GESTCOPY_R2_BUCKET}"
echo "backup-files: dest   B2:${GESTCOPY_B2_BUCKET}/${GESTCOPY_B2_FILES_PREFIX}"
echo "backup-files: mode   rclone copy (additive; no delete)"

# Intentionally NO --delete-* flags and NOT rclone sync.
# Paths under the bucket remain orders/{tenant_id}/{order_id}/{file_id}
# and land under ${GESTCOPY_B2_FILES_PREFIX}/orders/... on B2.
rclone copy \
  "R2:${GESTCOPY_R2_BUCKET}" \
  "B2:${GESTCOPY_B2_BUCKET}/${GESTCOPY_B2_FILES_PREFIX}" \
  --stats 30s \
  --stats-one-line \
  --log-level INFO

FINISHED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "backup-files: finished ${FINISHED_AT} UTC"
echo "BACKUP_FILES_SUCCESS"
