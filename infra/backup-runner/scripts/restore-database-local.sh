#!/usr/bin/env bash
# Isolated local restore helper for Gestcopy database backup artifacts.
# NEVER restores into Production. Never uses GESTCOPY_DATABASE_URL as target.
set -Eeuo pipefail

usage() {
  cat >&2 <<'EOF'
Usage: restore-database-local.sh --application PATH --auth PATH --migrations PATH

Requires:
  GESTCOPY_ALLOW_RESTORE=isolated-only
  GESTCOPY_ALLOW_PUBLIC_RESET=isolated-only
  GESTCOPY_RESTORE_TARGET_URL
  GESTCOPY_PRODUCTION_PROJECT_REF
  GESTCOPY_RESTORE_TARGET_PROJECT_REF

Refuses Production when:
  - target project ref equals production project ref
  - target URL contains the production project ref (case-insensitive)
  - GESTCOPY_DATABASE_URL is set and equals the target URL

Optional:
  --skip-migrations

Restore order (isolated Supabase-compatible target only):
  1. DROP SCHEMA IF EXISTS public CASCADE
  2. application --section=pre-data (recreates public)
  3. application --section=data
  4. auth data, excluding auth.schema_migrations (mandatory)
  5. supabase_migrations schema + data (unless --skip-migrations)
  6. application --section=post-data

Artifacts must already be decrypted locally (*.dump, not *.dump.age).
EOF
}

APPLICATION_DUMP=""
AUTH_DUMP=""
MIGRATIONS_DUMP=""
SKIP_MIGRATIONS=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --application)
      APPLICATION_DUMP="${2:-}"
      shift 2
      ;;
    --auth)
      AUTH_DUMP="${2:-}"
      shift 2
      ;;
    --migrations)
      MIGRATIONS_DUMP="${2:-}"
      shift 2
      ;;
    --skip-migrations)
      SKIP_MIGRATIONS=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "ERROR: unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ -z "${APPLICATION_DUMP}" ]]; then
  echo "ERROR: --application PATH is required" >&2
  usage
  exit 1
fi

if [[ "${GESTCOPY_ALLOW_RESTORE:-}" != "isolated-only" ]]; then
  echo "ERROR: set GESTCOPY_ALLOW_RESTORE=isolated-only to confirm an isolated restore" >&2
  exit 1
fi

if [[ "${GESTCOPY_ALLOW_PUBLIC_RESET:-}" != "isolated-only" ]]; then
  echo "ERROR: set GESTCOPY_ALLOW_PUBLIC_RESET=isolated-only to confirm destructive public reset" >&2
  exit 1
fi

if [[ -z "${GESTCOPY_RESTORE_TARGET_URL:-}" ]]; then
  echo "ERROR: GESTCOPY_RESTORE_TARGET_URL is required (isolated target only)" >&2
  exit 1
fi

if [[ -z "${GESTCOPY_PRODUCTION_PROJECT_REF:-}" ]]; then
  echo "ERROR: GESTCOPY_PRODUCTION_PROJECT_REF is required" >&2
  exit 1
fi

if [[ -z "${GESTCOPY_RESTORE_TARGET_PROJECT_REF:-}" ]]; then
  echo "ERROR: GESTCOPY_RESTORE_TARGET_PROJECT_REF is required" >&2
  exit 1
fi

# Normalize refs for comparison without echoing connection strings.
prod_ref="$(printf '%s' "${GESTCOPY_PRODUCTION_PROJECT_REF}" | tr '[:upper:]' '[:lower:]')"
target_ref="$(printf '%s' "${GESTCOPY_RESTORE_TARGET_PROJECT_REF}" | tr '[:upper:]' '[:lower:]')"
target_url_lc="$(printf '%s' "${GESTCOPY_RESTORE_TARGET_URL}" | tr '[:upper:]' '[:lower:]')"

if [[ "${target_ref}" == "${prod_ref}" ]]; then
  echo "ERROR: restore target resolves to Production project ref" >&2
  exit 1
fi

if [[ "${target_url_lc}" == *"${prod_ref}"* ]]; then
  echo "ERROR: restore target resolves to Production project ref" >&2
  exit 1
fi

# Defense in depth when the production backup URL is also present in the environment.
if [[ -n "${GESTCOPY_DATABASE_URL:-}" && "${GESTCOPY_RESTORE_TARGET_URL}" == "${GESTCOPY_DATABASE_URL}" ]]; then
  echo "ERROR: restore target must not equal GESTCOPY_DATABASE_URL (production source)" >&2
  exit 1
fi

if [[ -z "${AUTH_DUMP}" ]]; then
  echo "ERROR: --auth PATH is required for full recovery" >&2
  usage
  exit 1
fi

if [[ "${SKIP_MIGRATIONS}" != "true" && -z "${MIGRATIONS_DUMP}" ]]; then
  echo "ERROR: --migrations PATH is required unless --skip-migrations is used" >&2
  usage
  exit 1
fi

preflight_archive() {
  local role="$1"
  local archive="$2"
  local listing="$3"
  if [[ ! -s "${archive}" ]]; then
    echo "ERROR: ${role} dump missing or empty" >&2
    exit 1
  fi
  if ! pg_restore --list "${archive}" >"${listing}"; then
    echo "ERROR: ${role} dump is not a readable PostgreSQL archive" >&2
    exit 1
  fi
}

# All local artifact checks happen before the first target connection or mutation.
PREFLIGHT_DIR="$(mktemp -d "${TMPDIR:-/tmp}/gestcopy-restore-preflight.XXXXXX")"
trap 'rm -rf "${PREFLIGHT_DIR}"' EXIT
preflight_archive application "${APPLICATION_DUMP}" "${PREFLIGHT_DIR}/application.list"
preflight_archive auth "${AUTH_DUMP}" "${PREFLIGHT_DIR}/auth.list"
if [[ "${SKIP_MIGRATIONS}" != "true" ]]; then
  preflight_archive migrations "${MIGRATIONS_DUMP}" "${PREFLIGHT_DIR}/migrations.list"
fi

if ! grep -Eq 'SCHEMA[[:space:]]+-[[:space:]]+public([[:space:]]|$)' "${PREFLIGHT_DIR}/application.list"; then
  echo "ERROR: application archive does not define schema public" >&2
  exit 1
fi

# A new Supabase project may not have this schema at all. Require an archive that
# can recreate both the schema and its migration history before resetting public.
if [[ "${SKIP_MIGRATIONS}" != "true" ]]; then
  if ! grep -Eq 'SCHEMA[[:space:]]+-[[:space:]]+supabase_migrations([[:space:]]|$)' "${PREFLIGHT_DIR}/migrations.list"; then
    echo "ERROR: migrations archive does not define schema supabase_migrations" >&2
    exit 1
  fi
  if ! grep -Eq 'TABLE DATA[[:space:]]+supabase_migrations[[:space:]]+schema_migrations([[:space:]]|$)' "${PREFLIGHT_DIR}/migrations.list"; then
    echo "ERROR: migrations archive does not contain supabase_migrations.schema_migrations data" >&2
    exit 1
  fi
fi

# Backups created before B1.3.1 can contain auth.schema_migrations. Do not let
# those internal Auth-version records reach the target, even when restoring an
# old archive. pg_restore --use-list accepts the filtered TOC listing.
AUTH_RESTORE_LIST="${PREFLIGHT_DIR}/auth.restore.list"
grep -Ev 'TABLE DATA[[:space:]]+auth[[:space:]]+schema_migrations([[:space:]]|$)' \
  "${PREFLIGHT_DIR}/auth.list" >"${AUTH_RESTORE_LIST}"

: "${PGSSLMODE:=require}"
: "${PGAPPNAME:=gestcopy-restore-isolated}"
: "${PGCONNECT_TIMEOUT:=15}"
export PGSSLMODE PGAPPNAME PGCONNECT_TIMEOUT

restore_application_section() {
  local section="$1"
  echo "restore-database-local: application section=${section}"
  # Apply ACL/GRANT/REVOKE from the application archive (do not suppress privileges).
  pg_restore \
    --dbname="${GESTCOPY_RESTORE_TARGET_URL}" \
    --section="${section}" \
    --no-owner \
    --exit-on-error \
    "${APPLICATION_DUMP}"
}

echo "restore-database-local: resetting public schema on confirmed isolated target"
psql "${GESTCOPY_RESTORE_TARGET_URL}" \
  -v ON_ERROR_STOP=1 \
  -c 'DROP SCHEMA IF EXISTS public CASCADE;'

echo "restore-database-local: restoring application pre-data (recreates public)"
restore_application_section pre-data

echo "restore-database-local: restoring application data"
restore_application_section data

echo "restore-database-local: restoring mandatory auth data before application post-data (FK to auth.users)"
pg_restore \
  --dbname="${GESTCOPY_RESTORE_TARGET_URL}" \
  --data-only \
  --no-owner \
  --no-privileges \
  --exit-on-error \
  --use-list="${AUTH_RESTORE_LIST}" \
  "${AUTH_DUMP}"

if [[ "${SKIP_MIGRATIONS}" == "true" ]]; then
  echo "restore-database-local: skipping migrations dump (--skip-migrations)"
else
  echo "restore-database-local: restoring supabase_migrations schema and data"
  pg_restore \
    --dbname="${GESTCOPY_RESTORE_TARGET_URL}" \
    --no-owner \
    --no-privileges \
    --exit-on-error \
    "${MIGRATIONS_DUMP}"
fi

echo "restore-database-local: restoring application post-data (constraints/indexes/triggers/ACL)"
restore_application_section post-data

echo "RESTORE_DATABASE_ISOLATED_SUCCESS"
