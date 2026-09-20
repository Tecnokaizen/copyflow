#!/usr/bin/env bash
# Logical encrypted PostgreSQL/Supabase backup → Backblaze B2 (additive, never sync/delete).
# Platform-global dump (application / auth data / migration history). Not per-tenant.
set -Eeuo pipefail

require_var() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "ERROR: required environment variable ${name} is missing or empty" >&2
    exit 1
  fi
}

require_var GESTCOPY_DATABASE_URL
require_var GESTCOPY_BACKUP_AGE_RECIPIENT
require_var RCLONE_CONFIG_B2_TYPE
require_var RCLONE_CONFIG_B2_ACCOUNT
require_var RCLONE_CONFIG_B2_KEY
require_var GESTCOPY_B2_BUCKET

if [[ "${GESTCOPY_BACKUP_AGE_RECIPIENT}" != age1* ]]; then
  echo "ERROR: GESTCOPY_BACKUP_AGE_RECIPIENT must be an age public recipient (age1...)" >&2
  exit 1
fi

: "${GESTCOPY_B2_DATABASE_PREFIX:=database}"
: "${PGSSLMODE:=require}"
: "${PGAPPNAME:=gestcopy-backup-runner}"
: "${RCLONE_CONFIG_B2_HARD_DELETE:=false}"
export GESTCOPY_B2_DATABASE_PREFIX PGSSLMODE PGAPPNAME RCLONE_CONFIG_B2_HARD_DELETE

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/runner-lock.sh"
acquire_runner_lock

WORK_DIR=""
cleanup() {
  if [[ -n "${WORK_DIR}" && -d "${WORK_DIR}" ]]; then
    rm -rf "${WORK_DIR}"
  fi
}
trap cleanup EXIT

WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/gestcopy-db-backup.XXXXXX")"

TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
YEAR="${TIMESTAMP:0:4}"
MONTH="${TIMESTAMP:4:2}"
DAY="${TIMESTAMP:6:2}"
REMOTE_PREFIX="${GESTCOPY_B2_DATABASE_PREFIX}/${YEAR}/${MONTH}/${DAY}/${TIMESTAMP}"
REMOTE="B2:${GESTCOPY_B2_BUCKET}/${REMOTE_PREFIX}"

STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "backup-database: start ${STARTED_AT} UTC"
echo "backup-database: dest   ${REMOTE}"
echo "backup-database: mode   pg_dump custom + age + rclone copy (additive; no delete)"

# Connectivity / version probe — never echo GESTCOPY_DATABASE_URL.
echo "backup-database: probing postgres (select version)"
psql "${GESTCOPY_DATABASE_URL}" -Atqc "select version();" >/dev/null
POSTGRES_SERVER_VERSION="$(psql "${GESTCOPY_DATABASE_URL}" -Atqc "SHOW server_version;")"
echo "backup-database: postgres_server_version=${POSTGRES_SERVER_VERSION}"

APPLICATION_DUMP="${WORK_DIR}/gestcopy-application.dump"
AUTH_DUMP="${WORK_DIR}/gestcopy-auth.dump"
MIGRATIONS_DUMP="${WORK_DIR}/gestcopy-migrations.dump"

echo "backup-database: dumping application schema=public"
pg_dump \
  "${GESTCOPY_DATABASE_URL}" \
  --format=custom \
  --no-owner \
  --no-privileges \
  --no-subscriptions \
  --schema=public \
  --file="${APPLICATION_DUMP}"

echo "backup-database: dumping auth schema data-only"
pg_dump \
  "${GESTCOPY_DATABASE_URL}" \
  --format=custom \
  --data-only \
  --no-owner \
  --no-privileges \
  --schema=auth \
  --file="${AUTH_DUMP}"

echo "backup-database: dumping supabase_migrations.schema_migrations data-only"
pg_dump \
  "${GESTCOPY_DATABASE_URL}" \
  --format=custom \
  --data-only \
  --no-owner \
  --no-privileges \
  --table=supabase_migrations.schema_migrations \
  --file="${MIGRATIONS_DUMP}"

for dump in "${APPLICATION_DUMP}" "${AUTH_DUMP}" "${MIGRATIONS_DUMP}"; do
  if [[ ! -s "${dump}" ]]; then
    echo "ERROR: dump missing or empty: $(basename "${dump}")" >&2
    exit 1
  fi
done

encrypt_dump() {
  local plaintext="$1"
  local ciphertext="${plaintext}.age"
  age -r "${GESTCOPY_BACKUP_AGE_RECIPIENT}" -o "${ciphertext}" "${plaintext}"
  rm -f "${plaintext}"
  if [[ ! -s "${ciphertext}" ]]; then
    echo "ERROR: encrypted artifact missing or empty: $(basename "${ciphertext}")" >&2
    exit 1
  fi
  if [[ -e "${plaintext}" ]]; then
    echo "ERROR: plaintext dump still present after encryption: $(basename "${plaintext}")" >&2
    exit 1
  fi
}

echo "backup-database: encrypting dumps with age recipient"
encrypt_dump "${APPLICATION_DUMP}"
encrypt_dump "${AUTH_DUMP}"
encrypt_dump "${MIGRATIONS_DUMP}"

APPLICATION_AGE="${APPLICATION_DUMP}.age"
AUTH_AGE="${AUTH_DUMP}.age"
MIGRATIONS_AGE="${MIGRATIONS_DUMP}.age"

artifact_json() {
  local path="$1"
  local role="$2"
  local bytes sha
  bytes="$(wc -c <"${path}" | tr -d ' ')"
  sha="$(sha256sum "${path}" | awk '{print $1}')"
  jq -nc \
    --arg name "$(basename "${path}")" \
    --arg role "${role}" \
    --argjson bytes "${bytes}" \
    --arg sha256 "${sha}" \
    '{name:$name,role:$role,bytes:$bytes,sha256:$sha256}'
}

APPLICATION_META="$(artifact_json "${APPLICATION_AGE}" application)"
AUTH_META="$(artifact_json "${AUTH_AGE}" auth)"
MIGRATIONS_META="$(artifact_json "${MIGRATIONS_AGE}" migrations)"

MANIFEST="${WORK_DIR}/manifest.json"
jq -nc \
  --arg version "1" \
  --arg created_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --arg postgres_server_version "${POSTGRES_SERVER_VERSION}" \
  --argjson application "${APPLICATION_META}" \
  --argjson auth "${AUTH_META}" \
  --argjson migrations "${MIGRATIONS_META}" \
  '{
    version: $version,
    created_at: $created_at,
    postgres_server_version: $postgres_server_version,
    backup_format: "postgresql-custom",
    encryption: "age",
    source: "gestcopy-production-postgres",
    artifacts: [$application, $auth, $migrations]
  }' >"${MANIFEST}"

echo "backup-database: uploading encrypted artifacts (rclone copy)"
# Intentionally NO rclone sync and NO --delete-* flags.
rclone copy \
  "${WORK_DIR}/" \
  "${REMOTE}/" \
  --include "gestcopy-*.dump.age" \
  --include "manifest.json" \
  --stats 30s \
  --stats-one-line \
  --log-level INFO

verify_remote_size() {
  local name="$1"
  local expected_bytes="$2"
  local listing size
  listing="$(rclone lsjson "${REMOTE}/${name}")"
  size="$(echo "${listing}" | jq -r '.[0].Size // empty')"
  if [[ -z "${size}" ]]; then
    echo "ERROR: remote object missing after upload: ${name}" >&2
    exit 1
  fi
  if [[ "${size}" != "${expected_bytes}" ]]; then
    echo "ERROR: remote size mismatch for ${name}: expected ${expected_bytes}, got ${size}" >&2
    exit 1
  fi
}

echo "backup-database: verifying remote listing and sizes (no re-download)"
# Deep checksum verification without download is deferred to recovery drills;
# B2/rclone hash probes are not required on every scheduled backup run.
verify_remote_size "gestcopy-application.dump.age" "$(echo "${APPLICATION_META}" | jq -r '.bytes')"
verify_remote_size "gestcopy-auth.dump.age" "$(echo "${AUTH_META}" | jq -r '.bytes')"
verify_remote_size "gestcopy-migrations.dump.age" "$(echo "${MIGRATIONS_META}" | jq -r '.bytes')"
verify_remote_size "manifest.json" "$(wc -c <"${MANIFEST}" | tr -d ' ')"

FINISHED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "backup-database: finished ${FINISHED_AT} UTC"
echo "DATABASE_BACKUP_SUCCESS"
