#!/usr/bin/env bash
# Isolated local restore helper for Gestcopy database backup artifacts.
# NEVER restores into Production. Never uses GESTCOPY_DATABASE_URL as target.
set -Eeuo pipefail

usage() {
  cat >&2 <<'EOF'
Usage: restore-database-local.sh --application PATH [--auth PATH] [--migrations PATH]

Requires:
  GESTCOPY_RESTORE_TARGET_URL   connection URI of an ISOLATED restore target
  GESTCOPY_ALLOW_RESTORE=isolated-only

Refuses:
  GESTCOPY_DATABASE_URL as restore target
  identical source and target URLs
  any restore when GESTCOPY_ALLOW_RESTORE is not exactly isolated-only

Optional:
  --skip-auth     omit auth data restore (e.g. vanilla PostgreSQL without Auth schema)
  --skip-migrations

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

# Never treat the production backup source URL as a restore target.
if [[ -n "${GESTCOPY_DATABASE_URL:-}" && "${GESTCOPY_RESTORE_TARGET_URL}" == "${GESTCOPY_DATABASE_URL}" ]]; then
  echo "ERROR: restore target must not equal GESTCOPY_DATABASE_URL (production source)" >&2
  exit 1
fi

: "${PGSSLMODE:=require}"
: "${PGAPPNAME:=gestcopy-restore-isolated}"
export PGSSLMODE PGAPPNAME

echo "restore-database-local: restoring application dump (isolated target)"
pg_restore \
  --dbname="${GESTCOPY_RESTORE_TARGET_URL}" \
  --no-owner \
  --no-privileges \
  --exit-on-error \
  "${APPLICATION_DUMP}"

if [[ "${SKIP_AUTH}" == "true" ]]; then
  echo "restore-database-local: skipping auth dump (--skip-auth)"
elif [[ -n "${AUTH_DUMP}" ]]; then
  if [[ ! -s "${AUTH_DUMP}" ]]; then
    echo "ERROR: auth dump missing or empty" >&2
    exit 1
  fi
  echo "restore-database-local: restoring auth data (compat must be validated separately)"
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

echo "RESTORE_DATABASE_ISOLATED_SUCCESS"
