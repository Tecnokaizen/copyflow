#!/usr/bin/env bash
# Logical encrypted PostgreSQL/Supabase backup → Backblaze B2 (additive, never sync/delete).
# Platform-global dump (application / auth data / migration history). Not per-tenant.
# The three dumps share one exported PostgreSQL snapshot for a coherent recovery set.
# The application dump covers `public` and every Gestcopy private schema, discovered
# in that same snapshot (recovery-contract.sh), never a hardcoded subset.
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
: "${PGCONNECT_TIMEOUT:=15}"
: "${GESTCOPY_SNAPSHOT_ACQUIRE_TIMEOUT_SECONDS:=30}"
: "${GESTCOPY_CATALOG_QUERY_TIMEOUT_SECONDS:=600}"
: "${RCLONE_CONFIG_B2_HARD_DELETE:=false}"
export GESTCOPY_B2_DATABASE_PREFIX PGSSLMODE PGAPPNAME PGCONNECT_TIMEOUT \
  GESTCOPY_SNAPSHOT_ACQUIRE_TIMEOUT_SECONDS GESTCOPY_CATALOG_QUERY_TIMEOUT_SECONDS \
  RCLONE_CONFIG_B2_HARD_DELETE

if [[ ! "${GESTCOPY_SNAPSHOT_ACQUIRE_TIMEOUT_SECONDS}" =~ ^[1-9][0-9]*$ ]]; then
  echo "ERROR: GESTCOPY_SNAPSHOT_ACQUIRE_TIMEOUT_SECONDS must be a positive integer" >&2
  exit 1
fi

if [[ ! "${GESTCOPY_CATALOG_QUERY_TIMEOUT_SECONDS}" =~ ^[1-9][0-9]*$ ]]; then
  echo "ERROR: GESTCOPY_CATALOG_QUERY_TIMEOUT_SECONDS must be a positive integer" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/runner-lock.sh"
source "${SCRIPT_DIR}/recovery-contract.sh"
acquire_runner_lock

WORK_DIR=""
EXPORTER_PID=""
SNAPSHOT_ID=""
EXPORTER_FD_OPEN=false

stop_snapshot_exporter() {
  if [[ -n "${EXPORTER_PID}" ]]; then
    if kill -0 "${EXPORTER_PID}" 2>/dev/null; then
      # Prefer ROLLBACK so a failed backup does not leave an open read txn.
      if [[ "${EXPORTER_FD_OPEN}" == "true" ]]; then
        printf 'ROLLBACK;\n\\q\n' >&3 2>/dev/null || true
      fi
      if [[ "${EXPORTER_FD_OPEN}" == "true" ]]; then
        exec 3>&- 2>/dev/null || true
        EXPORTER_FD_OPEN=false
      fi
      wait "${EXPORTER_PID}" 2>/dev/null || true
    else
      if [[ "${EXPORTER_FD_OPEN}" == "true" ]]; then
        exec 3>&- 2>/dev/null || true
        EXPORTER_FD_OPEN=false
      fi
    fi
    EXPORTER_PID=""
  elif [[ "${EXPORTER_FD_OPEN}" == "true" ]]; then
    exec 3>&- 2>/dev/null || true
    EXPORTER_FD_OPEN=false
  fi
}

cleanup() {
  stop_snapshot_exporter
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
echo "backup-database: mode   pg_dump custom + shared snapshot + age + rclone copyto (additive; no delete)"

# Connectivity / version probe — never echo GESTCOPY_DATABASE_URL.
echo "backup-database: probing postgres (select version)"
psql "${GESTCOPY_DATABASE_URL}" -Atqc "select version();" >/dev/null
POSTGRES_SERVER_VERSION="$(psql "${GESTCOPY_DATABASE_URL}" -Atqc "SHOW server_version;")"
echo "backup-database: postgres_server_version=${POSTGRES_SERVER_VERSION}"

APPLICATION_DUMP="${WORK_DIR}/gestcopy-application.dump"
AUTH_DUMP="${WORK_DIR}/gestcopy-auth.dump"
MIGRATIONS_DUMP="${WORK_DIR}/gestcopy-migrations.dump"

echo "backup-database: opening REPEATABLE READ snapshot exporter"
# Keep one read-only transaction open and export its snapshot for all three dumps.
# stdin stays open via FIFO so the transaction is not closed until we COMMIT.
# Never print GESTCOPY_DATABASE_URL.
SQL_FIFO="${WORK_DIR}/exporter.sql.fifo"
PSQL_OUT="${WORK_DIR}/exporter.out"
PSQL_ERR="${WORK_DIR}/exporter.err"
mkfifo "${SQL_FIFO}"
psql "${GESTCOPY_DATABASE_URL}" -v ON_ERROR_STOP=1 -Atq \
  <"${SQL_FIFO}" >"${PSQL_OUT}" 2>"${PSQL_ERR}" &
EXPORTER_PID=$!
# Opening the write end unblocks psql's read on the FIFO.
exec 3>"${SQL_FIFO}"
EXPORTER_FD_OPEN=true

printf '%s\n' \
  "BEGIN ISOLATION LEVEL REPEATABLE READ, READ ONLY;" \
  "SELECT pg_export_snapshot();" >&3

SNAPSHOT_ID=""
SNAPSHOT_WAIT_STARTED_AT=${SECONDS}
while (( SECONDS - SNAPSHOT_WAIT_STARTED_AT < GESTCOPY_SNAPSHOT_ACQUIRE_TIMEOUT_SECONDS )); do
  if [[ -s "${PSQL_OUT}" ]]; then
    IFS= read -r SNAPSHOT_ID <"${PSQL_OUT}" || true
    break
  fi
  if ! kill -0 "${EXPORTER_PID}" 2>/dev/null; then
    echo "ERROR: snapshot exporter exited before producing a snapshot" >&2
    exit 1
  fi
  sleep 0.1
done

if [[ -z "${SNAPSHOT_ID}" || "${SNAPSHOT_ID}" == *" "* ]]; then
  echo "ERROR: timed out waiting for a valid PostgreSQL exported snapshot" >&2
  if [[ -s "${PSQL_ERR}" ]]; then
    # Log exporter diagnostics without connection strings.
    sed -E 's#postgresql://[^[:space:]]+#postgresql://[redacted]#gi' "${PSQL_ERR}" >&2 || true
  fi
  exit 1
fi
if ! kill -0 "${EXPORTER_PID}" 2>/dev/null; then
  echo "ERROR: snapshot exporter exited before dumps started" >&2
  exit 1
fi
echo "backup-database: acquired shared exported snapshot"

ensure_exporter_alive() {
  if ! kill -0 "${EXPORTER_PID}" 2>/dev/null; then
    echo "ERROR: snapshot exporter terminated unexpectedly during dumps" >&2
    exit 1
  fi
}

# Runs one single-line query inside the exporter session (the snapshot
# transaction itself) and prints the payload of its "<marker>|..." result row.
exporter_query() {
  local marker="$1"
  local sql="$2"
  local line=""
  local started=${SECONDS}
  printf '%s\n' "${sql}" >&3
  while (( SECONDS - started < GESTCOPY_CATALOG_QUERY_TIMEOUT_SECONDS )); do
    line="$(grep -m1 "^${marker}|" "${PSQL_OUT}" || true)"
    if [[ -n "${line}" ]]; then
      printf '%s' "${line#"${marker}|"}"
      return 0
    fi
    if ! kill -0 "${EXPORTER_PID}" 2>/dev/null; then
      echo "ERROR: snapshot exporter terminated while reading ${marker}" >&2
      if [[ -s "${PSQL_ERR}" ]]; then
        sed -E 's#postgresql://[^[:space:]]+#postgresql://[redacted]#gi' "${PSQL_ERR}" >&2 || true
      fi
      exit 1
    fi
    sleep 0.1
  done
  echo "ERROR: timed out waiting for ${marker} from the snapshot exporter" >&2
  exit 1
}

join_by_comma() {
  local IFS=,
  printf '%s' "$*"
}

echo "backup-database: discovering application schemas in the shared snapshot"
# Fully qualified deparse and exact counts (an RLS-filtered count fails loudly).
printf '%s\n' "SET search_path TO ''; SET row_security TO off;" >&3
APPLICATION_SCHEMAS_CSV="$(exporter_query gestcopy-application-schemas "$(application_schemas_sql)")"
IFS=',' read -r -a APPLICATION_SCHEMAS <<<"${APPLICATION_SCHEMAS_CSV}"
for schema in "${APPLICATION_SCHEMAS[@]}"; do
  if ! valid_schema_name "${schema}"; then
    echo "ERROR: unexpected application schema name in source catalog" >&2
    exit 1
  fi
done
for required in "${GESTCOPY_REQUIRED_APPLICATION_SCHEMAS[@]}"; do
  if [[ ",${APPLICATION_SCHEMAS_CSV}," != *",${required},"* ]]; then
    echo "ERROR: required application schema missing in source: ${required}" >&2
    exit 1
  fi
done
echo "backup-database: application schemas ${APPLICATION_SCHEMAS_CSV}"

echo "backup-database: recording recovery fingerprint in the shared snapshot"
RECOVERY_FINGERPRINT="$(exporter_query gestcopy-recovery-fingerprint "$(recovery_fingerprint_sql "${APPLICATION_SCHEMAS[@]}")")"
if ! jq -e \
  --argjson version "${GESTCOPY_FINGERPRINT_VERSION}" \
  --arg schemas "${APPLICATION_SCHEMAS_CSV}" \
  '.fingerprint_version == $version and ((.schemas | keys | join(",")) == $schemas)' \
  <<<"${RECOVERY_FINGERPRINT}" >/dev/null; then
  echo "ERROR: recovery fingerprint does not cover the application schemas" >&2
  exit 1
fi

APPLICATION_SCHEMA_ARGS=()
for schema in "${APPLICATION_SCHEMAS[@]}"; do
  APPLICATION_SCHEMA_ARGS+=("--schema=${schema}")
done

echo "backup-database: dumping application schemas ${APPLICATION_SCHEMAS_CSV} (ACL preserved)"
ensure_exporter_alive
# Preserve GRANT/REVOKE/ACL (do not pass privilege-suppression). --strict-names:
# every discovered schema must be matched.
pg_dump \
  "${GESTCOPY_DATABASE_URL}" \
  --format=custom \
  --no-owner \
  --no-subscriptions \
  --strict-names \
  "${APPLICATION_SCHEMA_ARGS[@]}" \
  --snapshot="${SNAPSHOT_ID}" \
  --file="${APPLICATION_DUMP}"

echo "backup-database: dumping auth schema data-only (excluding auth.schema_migrations)"
ensure_exporter_alive
pg_dump \
  "${GESTCOPY_DATABASE_URL}" \
  --format=custom \
  --data-only \
  --no-owner \
  --no-privileges \
  --schema=auth \
  --exclude-table-data=auth.schema_migrations \
  --snapshot="${SNAPSHOT_ID}" \
  --file="${AUTH_DUMP}"

echo "backup-database: dumping full supabase_migrations schema and data"
ensure_exporter_alive
pg_dump \
  "${GESTCOPY_DATABASE_URL}" \
  --format=custom \
  --no-owner \
  --no-privileges \
  --schema=supabase_migrations \
  --snapshot="${SNAPSHOT_ID}" \
  --file="${MIGRATIONS_DUMP}"

ensure_exporter_alive
echo "backup-database: closing snapshot exporter"
printf 'COMMIT;\n\\q\n' >&3
exec 3>&-
EXPORTER_FD_OPEN=false
wait "${EXPORTER_PID}"
EXPORTER_PID=""

for dump in "${APPLICATION_DUMP}" "${AUTH_DUMP}" "${MIGRATIONS_DUMP}"; do
  if [[ ! -s "${dump}" ]]; then
    echo "ERROR: dump missing or empty: $(basename "${dump}")" >&2
    exit 1
  fi
done

echo "backup-database: preflighting custom archives before encryption/upload"
for dump in "${APPLICATION_DUMP}" "${AUTH_DUMP}" "${MIGRATIONS_DUMP}"; do
  if ! pg_restore --list "${dump}" >"${dump}.list"; then
    echo "ERROR: unreadable PostgreSQL archive: $(basename "${dump}")" >&2
    exit 1
  fi
done

# The application archive must contain exactly the discovered schemas and every
# table the snapshot catalog reports for them.
mapfile -t ARCHIVED_SCHEMAS < <(archive_schemas "${APPLICATION_DUMP}.list")
ARCHIVED_SCHEMAS_CSV="$(join_by_comma "${ARCHIVED_SCHEMAS[@]}")"
for schema in "${APPLICATION_SCHEMAS[@]}"; do
  if [[ ",${ARCHIVED_SCHEMAS_CSV}," != *",${schema},"* ]]; then
    echo "ERROR: application archive omits schema ${schema}" >&2
    exit 1
  fi
done
if [[ "${ARCHIVED_SCHEMAS_CSV}" != "${APPLICATION_SCHEMAS_CSV}" ]]; then
  echo "ERROR: application archive schemas differ from the discovered application schemas" >&2
  exit 1
fi
ARCHIVED_TABLE_COUNTS="$(archive_table_counts "${APPLICATION_DUMP}.list")"
for schema in "${APPLICATION_SCHEMAS[@]}"; do
  expected_tables="$(jq -r --arg schema "${schema}" '.schemas[$schema].tables' <<<"${RECOVERY_FINGERPRINT}")"
  archived_tables="$(awk -v schema="${schema}" '$1 == schema { print $2 }' <<<"${ARCHIVED_TABLE_COUNTS}")"
  if [[ "${archived_tables:-0}" != "${expected_tables}" ]]; then
    echo "ERROR: application archive has ${archived_tables:-0} tables in ${schema}, catalog has ${expected_tables}" >&2
    exit 1
  fi
done
rm -f "${APPLICATION_DUMP}.list" "${AUTH_DUMP}.list" "${MIGRATIONS_DUMP}.list"

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
# version 2: multi-schema application archive + recovery fingerprint (B1.3 fix).
jq -nc \
  --arg version "2" \
  --arg created_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --arg postgres_server_version "${POSTGRES_SERVER_VERSION}" \
  --arg application_schemas "${APPLICATION_SCHEMAS_CSV}" \
  --argjson recovery_contract "${RECOVERY_FINGERPRINT}" \
  --argjson application "${APPLICATION_META}" \
  --argjson auth "${AUTH_META}" \
  --argjson migrations "${MIGRATIONS_META}" \
  '{
    version: $version,
    created_at: $created_at,
    postgres_server_version: $postgres_server_version,
    backup_format: "postgresql-custom",
    encryption: "age",
    consistency: "postgresql-exported-snapshot",
    status: "complete",
    source: "gestcopy-production-postgres",
    recovery_compatibility: {
      auth_schema_migrations: "excluded",
      supabase_migrations: "schema-and-data",
      application_schemas: "all-non-platform-schemas"
    },
    application_schemas: ($application_schemas | split(",")),
    recovery_contract: $recovery_contract,
    external_recovery_requirements: [
      "supabase-vault:files_signing_secret",
      "supabase-vault:kiosk_signing_secret",
      "supabase-auth-config",
      "supabase-extensions",
      "supabase-automatic-rls"
    ],
    artifacts: [$application, $auth, $migrations]
  }' >"${MANIFEST}"

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

upload_artifact() {
  local local_path="$1"
  local name
  name="$(basename "${local_path}")"
  # Intentionally NO rclone sync and NO --delete-* flags.
  rclone copyto \
    "${local_path}" \
    "${REMOTE}/${name}" \
    --stats 30s \
    --stats-one-line \
    --log-level INFO
}

echo "backup-database: phase A — uploading encrypted dumps (manifest withheld)"
upload_artifact "${APPLICATION_AGE}"
upload_artifact "${AUTH_AGE}"
upload_artifact "${MIGRATIONS_AGE}"

echo "backup-database: phase B — verifying encrypted dump sizes (no re-download)"
# Deep checksum verification without download is deferred to recovery drills.
verify_remote_size "gestcopy-application.dump.age" "$(echo "${APPLICATION_META}" | jq -r '.bytes')"
verify_remote_size "gestcopy-auth.dump.age" "$(echo "${AUTH_META}" | jq -r '.bytes')"
verify_remote_size "gestcopy-migrations.dump.age" "$(echo "${MIGRATIONS_META}" | jq -r '.bytes')"

echo "backup-database: phase C — uploading manifest.json as completion marker"
upload_artifact "${MANIFEST}"
verify_remote_size "manifest.json" "$(wc -c <"${MANIFEST}" | tr -d ' ')"

FINISHED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "backup-database: finished ${FINISHED_AT} UTC"
echo "DATABASE_BACKUP_SUCCESS"
