#!/usr/bin/env bash
# Read-only verification that B2 Files backup matches R2 (one-way check + download).
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

: "${RCLONE_CONFIG_R2_REGION:=auto}"
: "${RCLONE_CONFIG_R2_NO_CHECK_BUCKET:=true}"
: "${RCLONE_CONFIG_B2_HARD_DELETE:=false}"

STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "verify-files: start ${STARTED_AT} UTC"
echo "verify-files: source R2:${GESTCOPY_R2_BUCKET}"
echo "verify-files: dest   B2:${GESTCOPY_B2_BUCKET}/${GESTCOPY_B2_FILES_PREFIX}"
echo "verify-files: mode   rclone check --one-way --download (read-only)"

rclone check \
  "R2:${GESTCOPY_R2_BUCKET}" \
  "B2:${GESTCOPY_B2_BUCKET}/${GESTCOPY_B2_FILES_PREFIX}" \
  --one-way \
  --download \
  --stats 30s \
  --stats-one-line \
  --log-level INFO

FINISHED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "verify-files: finished ${FINISHED_AT} UTC"
echo "VERIFY_FILES_SUCCESS"
