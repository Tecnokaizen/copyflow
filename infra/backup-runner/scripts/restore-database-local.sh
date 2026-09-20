#!/usr/bin/env bash
# Isolated local restore helper for Gestcopy database backup artifacts.
# NEVER restores into Production. Never uses GESTCOPY_DATABASE_URL as target.
set -Eeuo pipefail

usage() {
  cat >&2 <<'EOF'
Usage: restore-database-local.sh --application PATH [--auth PATH] [--migrations PATH]

Requires:
  GESTCOPY_ALLOW_RESTORE=isolated-only
  GESTCOPY_RESTORE_TARGET_URL
  GESTCOPY_PRODUCTION_PROJECT_REF
  GESTCOPY_RESTORE_TARGET_PROJECT_REF

Refuses Production when:
  - target project ref equals production project ref
  - target URL contains the production project ref (case-insensitive)
  - GESTCOPY_DATABASE_URL is set and equals the target URL

Optional:
  --skip-auth     omit auth data restore (e.g. vanilla PostgreSQL without Auth schema)
  --skip-migrations

Restore order (sectioned, so FKs to auth.users apply after auth data):
  1. application --section=pre-data
  2. application --section=data
  3. auth data (unless --skip-auth)
  4. migration history data (unless --skip-migrations)
  5. application --section=post-data

Artifacts must already be decrypted locally (*.dump, not *.dump.age).
EOF
}

APPLICATION_DUMP=""
AUTH_DUMP=""
MIGRATIONS_DUMP=""
SKIP_AUTH=false
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
    --skip-auth)
      SKIP_AUTH=true
      shift
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

if [[ ! -s "${APPLICATION_DUMP}" ]]; then
  echo "ERROR: application dump missing or empty" >&2
  exit 1
fi

if [[ "${GESTCOPY_ALLOW_RESTORE:-}" != "isolated-only" ]]; then
  echo "ERROR: set GESTCOPY_ALLOW_RESTORE=isolated-only to confirm an isolated restore" >&2
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

: "${PGSSLMODE:=require}"
: "${PGAPPNAME:=gestcopy-restore-isolated}"
export PGSSLMODE PGAPPNAME

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

echo "restore-database-local: restoring application pre-data (isolated target)"
restore_application_section pre-data

echo "restore-database-local: restoring application data"
restore_application_section data

if [[ "${SKIP_AUTH}" == "true" ]]; then
  echo "restore-database-local: skipping auth dump (--skip-auth)"
elif [[ -n "${AUTH_DUMP}" ]]; then
  if [[ ! -s "${AUTH_DUMP}" ]]; then
    echo "ERROR: auth dump missing or empty" >&2
    exit 1
  fi
  echo "restore-database-local: restoring auth data before application post-data (FK to auth.users)"
  pg_restore \
    --dbname="${GESTCOPY_RESTORE_TARGET_URL}" \
    --data-only \
    --no-owner \
    --no-privileges \
    --exit-on-error \
    "${AUTH_DUMP}"
else
  echo "ERROR: provide --auth PATH or pass --skip-auth" >&2
  exit 1
fi

if [[ "${SKIP_MIGRATIONS}" == "true" ]]; then
  echo "restore-database-local: skipping migrations dump (--skip-migrations)"
elif [[ -n "${MIGRATIONS_DUMP}" ]]; then
  if [[ ! -s "${MIGRATIONS_DUMP}" ]]; then
    echo "ERROR: migrations dump missing or empty" >&2
    exit 1
  fi
  echo "restore-database-local: restoring migration history data"
  pg_restore \
    --dbname="${GESTCOPY_RESTORE_TARGET_URL}" \
    --data-only \
    --no-owner \
    --no-privileges \
    --exit-on-error \
    "${MIGRATIONS_DUMP}"
else
  echo "ERROR: provide --migrations PATH or pass --skip-migrations" >&2
  exit 1
fi

echo "restore-database-local: restoring application post-data (constraints/indexes/triggers/ACL)"
restore_application_section post-data

echo "RESTORE_DATABASE_ISOLATED_SUCCESS"
