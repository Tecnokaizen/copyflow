#!/usr/bin/env bash
# Isolated local restore helper for Gestcopy database backup artifacts.
# NEVER restores into Production. Never uses GESTCOPY_DATABASE_URL as target.
set -Eeuo pipefail

usage() {
  cat >&2 <<'EOF'
Usage: restore-database-local.sh --manifest PATH --application PATH --auth PATH --migrations PATH

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

The manifest (version 2) declares the application schemas (public and every
Gestcopy private schema) and the recovery fingerprint the restore must reproduce.

Restore order (isolated Supabase-compatible target only):
  1. read-only target prerequisite checks (pg_trgm in extensions, PostgreSQL major)
  2. DROP SCHEMA IF EXISTS <schema> CASCADE for every application schema (public first),
     then CREATE SCHEMA public with its PostgreSQL initial privilege (USAGE to PUBLIC)
  3. application --section=pre-data (recreates the private schemas and every object)
  4. application --section=data
  5. auth data, excluding auth.schema_migrations (mandatory)
  6. supabase_migrations schema + data (unless --skip-migrations)
  7. application --section=post-data, excluding only supabase_admin DEFAULT ACLs
  8. read-only semantic validation and recovery fingerprint comparison

Artifacts must already be decrypted locally (*.dump, not *.dump.age).
EOF
}

MANIFEST=""
APPLICATION_DUMP=""
AUTH_DUMP=""
MIGRATIONS_DUMP=""
SKIP_MIGRATIONS=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --manifest)
      MANIFEST="${2:-}"
      shift 2
      ;;
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
# Keep the optional source URL in a local value: with `set -u`, expanding an unset
# GESTCOPY_DATABASE_URL on the right side of [[ ... && ... ]] would still abort.
source_database_url="${GESTCOPY_DATABASE_URL:-}"
if [[ -n "${source_database_url}" && "${GESTCOPY_RESTORE_TARGET_URL}" == "${source_database_url}" ]]; then
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

if [[ -z "${MANIFEST}" ]]; then
  echo "ERROR: --manifest PATH is required (it declares the application schemas)" >&2
  usage
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/recovery-contract.sh"

join_by_comma() {
  local IFS=,
  printf '%s' "$*"
}

# Version 1 sets hold only `public`: since the private schemas exist they cannot
# be restored completely (post-data references imports_private, files_private…).
if ! jq -e . "${MANIFEST}" >/dev/null 2>&1; then
  echo "ERROR: manifest is missing or is not valid JSON" >&2
  exit 1
fi
if ! jq -e '.status == "complete"' "${MANIFEST}" >/dev/null; then
  echo "ERROR: manifest status is not complete (incomplete backup set)" >&2
  exit 1
fi
manifest_version="$(jq -r '.version // "unknown"' "${MANIFEST}")"
if [[ "${manifest_version}" != "2" ]]; then
  echo "ERROR: manifest version ${manifest_version} is not a multi-schema recovery set; a public-only set (version 1) cannot be restored completely" >&2
  exit 1
fi
mapfile -t MANIFEST_SCHEMAS < <(jq -r '.application_schemas[]? // empty' "${MANIFEST}" | LC_ALL=C sort -u)
if [[ "${#MANIFEST_SCHEMAS[@]}" -eq 0 ]]; then
  echo "ERROR: manifest declares no application schemas" >&2
  exit 1
fi
for schema in "${MANIFEST_SCHEMAS[@]}"; do
  if ! valid_schema_name "${schema}"; then
    echo "ERROR: manifest declares an invalid application schema name" >&2
    exit 1
  fi
done
MANIFEST_SCHEMAS_CSV="$(join_by_comma "${MANIFEST_SCHEMAS[@]}")"
for required in "${GESTCOPY_REQUIRED_APPLICATION_SCHEMAS[@]}"; do
  if [[ ",${MANIFEST_SCHEMAS_CSV}," != *",${required},"* ]]; then
    echo "ERROR: manifest does not declare required application schema ${required}" >&2
    exit 1
  fi
done
if ! jq -e \
  --argjson version "${GESTCOPY_FINGERPRINT_VERSION}" \
  --arg schemas "${MANIFEST_SCHEMAS_CSV}" \
  '.recovery_contract.fingerprint_version == $version and ((.recovery_contract.schemas | keys | join(",")) == $schemas)' \
  "${MANIFEST}" >/dev/null; then
  echo "ERROR: manifest recovery fingerprint does not cover the declared application schemas" >&2
  exit 1
fi
SOURCE_POSTGRES_MAJOR="$(jq -r '.postgres_server_version // ""' "${MANIFEST}" | sed -E 's/^([0-9]+).*/\1/')"
if [[ ! "${SOURCE_POSTGRES_MAJOR}" =~ ^[0-9]+$ ]]; then
  echo "ERROR: manifest does not record the source PostgreSQL version" >&2
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

# The archive must define exactly the declared schemas, with every table of each.
mapfile -t ARCHIVED_SCHEMAS < <(archive_schemas "${PREFLIGHT_DIR}/application.list")
ARCHIVED_SCHEMAS_CSV="$(join_by_comma "${ARCHIVED_SCHEMAS[@]}")"
for schema in "${MANIFEST_SCHEMAS[@]}"; do
  if [[ ",${ARCHIVED_SCHEMAS_CSV}," != *",${schema},"* ]]; then
    echo "ERROR: application archive does not define schema ${schema}" >&2
    exit 1
  fi
done
for schema in "${ARCHIVED_SCHEMAS[@]}"; do
  if [[ ",${MANIFEST_SCHEMAS_CSV}," != *",${schema},"* ]]; then
    echo "ERROR: application archive defines schema ${schema}, which the manifest does not declare" >&2
    exit 1
  fi
done
ARCHIVED_TABLE_COUNTS="$(archive_table_counts "${PREFLIGHT_DIR}/application.list")"
for schema in "${MANIFEST_SCHEMAS[@]}"; do
  expected_tables="$(jq -r --arg schema "${schema}" '.recovery_contract.schemas[$schema].tables' "${MANIFEST}")"
  archived_tables="$(awk -v schema="${schema}" '$1 == schema { print $2 }' <<<"${ARCHIVED_TABLE_COUNTS}")"
  if [[ "${archived_tables:-0}" != "${expected_tables}" ]]; then
    echo "ERROR: application archive has ${archived_tables:-0} tables in ${schema}, manifest declares ${expected_tables}" >&2
    exit 1
  fi
done

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

# `supabase_admin` is an internal Supabase role. A normal project `postgres`
# connection cannot change its default privileges, so restoring that one TOC
# object aborts an otherwise valid post-data restore. Filter only its DEFAULT
# ACL entries; normal ACLs and DEFAULT ACLs owned by postgres remain selected.
APPLICATION_POST_DATA_RESTORE_LIST="${PREFLIGHT_DIR}/application.post-data.restore.list"

# PostgreSQL 15+ records USAGE on `public` for PUBLIC as an initial privilege
# (pg_init_privs), so pg_dump never emits it and the dumped ACL of `public` is
# relative to it. The reset recreates `public` with that baseline; pre-data then
# restores everything else, including any REVOKE the source applied to it.
APPLICATION_PRE_DATA_RESTORE_LIST="${PREFLIGHT_DIR}/application.pre-data.restore.list"
awk '
  /^[0-9]+;/ && $4 == "SCHEMA" && $5 == "-" && $6 == "public" { next }
  { print }
' "${PREFLIGHT_DIR}/application.list" >"${APPLICATION_PRE_DATA_RESTORE_LIST}"
awk '
  /^[0-9]+;/ && / DEFAULT ACL / && $NF == "supabase_admin" { next }
  { print }
' "${PREFLIGHT_DIR}/application.list" >"${APPLICATION_POST_DATA_RESTORE_LIST}"

: "${PGSSLMODE:=require}"
: "${PGAPPNAME:=gestcopy-restore-isolated}"
: "${PGCONNECT_TIMEOUT:=15}"
export PGSSLMODE PGAPPNAME PGCONNECT_TIMEOUT

restore_application_section() {
  local section="$1"
  local restore_list="$2"
  echo "restore-database-local: application section=${section}"
  # Apply ACL/GRANT/REVOKE from the application archive (do not suppress privileges).
  pg_restore \
    --dbname="${GESTCOPY_RESTORE_TARGET_URL}" \
    --section="${section}" \
    --no-owner \
    --exit-on-error \
    --use-list="${restore_list}" \
    "${APPLICATION_DUMP}"
}

preflight_target_extensions() {
  local extension_contract
  extension_contract="$(
    psql "${GESTCOPY_RESTORE_TARGET_URL}" \
      -v ON_ERROR_STOP=1 \
      -Atqc "
        SELECT 'pg_trgm@extensions'
        WHERE EXISTS (
          SELECT 1
          FROM pg_extension extension
          JOIN pg_namespace schema ON schema.oid = extension.extnamespace
          WHERE extension.extname = 'pg_trgm'
            AND schema.nspname = 'extensions'
        );
      "
  )"

  if [[ "${extension_contract}" != "pg_trgm@extensions" ]]; then
    echo "ERROR: target prerequisite pg_trgm must be installed in schema extensions before resetting public" >&2
    exit 1
  fi
}

# The fingerprint compares deparsed definitions, which are stable within one
# PostgreSQL major version only.
preflight_target_postgres_major() {
  local target_major
  target_major="$(
    psql "${GESTCOPY_RESTORE_TARGET_URL}" \
      -v ON_ERROR_STOP=1 \
      -Atqc "SELECT 'gestcopy-target-major|' || (current_setting('server_version_num')::int / 10000);"
  )"
  target_major="${target_major#gestcopy-target-major|}"
  if [[ "${target_major}" != "${SOURCE_POSTGRES_MAJOR}" ]]; then
    echo "ERROR: target PostgreSQL major ${target_major} differs from source major ${SOURCE_POSTGRES_MAJOR}" >&2
    exit 1
  fi
}

reset_application_schemas() {
  local statements="" schema
  # public first keeps the historic reset order; the others follow sorted.
  statements="DROP SCHEMA IF EXISTS public CASCADE;"
  for schema in "${MANIFEST_SCHEMAS[@]}"; do
    [[ "${schema}" == "public" ]] && continue
    statements+=" DROP SCHEMA IF EXISTS ${schema} CASCADE;"
  done
  statements+=" CREATE SCHEMA public; GRANT USAGE ON SCHEMA public TO PUBLIC;"
  psql "${GESTCOPY_RESTORE_TARGET_URL}" \
    -v ON_ERROR_STOP=1 \
    --single-transaction \
    -c "${statements}"
}

compare_recovery_fingerprint() {
  local line actual expected mismatches
  line="$(
    psql "${GESTCOPY_RESTORE_TARGET_URL}" \
      -v ON_ERROR_STOP=1 \
      -Atq \
      -c "SET search_path TO ''; SET row_security TO off;" \
      -c "$(recovery_fingerprint_sql "${MANIFEST_SCHEMAS[@]}")"
  )"
  actual="${line#gestcopy-recovery-fingerprint|}"
  expected="$(jq -c '.recovery_contract' "${MANIFEST}")"
  if ! jq -e . <<<"${actual}" >/dev/null 2>&1; then
    echo "ERROR: target recovery fingerprint is not valid JSON" >&2
    exit 1
  fi
  mismatches="$(
    jq -nr --argjson expected "${expected}" --argjson actual "${actual}" '
      [ $expected.schemas | to_entries[] | .key as $schema | .value | to_entries[]
        | select(.value != ($actual.schemas[$schema][.key] // null))
        | "\($schema).\(.key): expected \(.value), restored \($actual.schemas[$schema][.key] // "missing")" ]
      + (if $expected.fingerprint_version != $actual.fingerprint_version then ["fingerprint_version differs"] else [] end)
      | .[]'
  )"
  if [[ -n "${mismatches}" ]]; then
    echo "ERROR: restored target does not match the recovery fingerprint:" >&2
    while IFS= read -r mismatch; do
      printf '  %s\n' "${mismatch}" >&2
    done <<<"${mismatches}"
    echo "ERROR: post-restore semantic validation failed; RESTORE_DATABASE_ISOLATED_SUCCESS will not be printed" >&2
    exit 1
  fi
  echo "restore-database-local: recovery fingerprint matches for ${MANIFEST_SCHEMAS_CSV}"
}

validate_restored_target() {
  local validation public_schema_exists public_table_count public_tables_without_rls policy_count migrations_table_exists
  validation="$(
    psql "${GESTCOPY_RESTORE_TARGET_URL}" \
      -v ON_ERROR_STOP=1 \
      -At \
      -F '|' \
      -c "
        /* gestcopy-post-restore-validation */
        SELECT
          to_regnamespace('public') IS NOT NULL,
          (SELECT count(*)
           FROM pg_class table_class
           JOIN pg_namespace schema ON schema.oid = table_class.relnamespace
           WHERE schema.nspname = 'public'
             AND table_class.relkind IN ('r', 'p')),
          (SELECT count(*)
           FROM pg_class table_class
           JOIN pg_namespace schema ON schema.oid = table_class.relnamespace
           WHERE schema.nspname = 'public'
             AND table_class.relkind IN ('r', 'p')
             AND NOT table_class.relrowsecurity),
          (SELECT count(*) FROM pg_policies WHERE schemaname = 'public'),
          $(if [[ "${SKIP_MIGRATIONS}" == "true" ]]; then printf 'true'; else printf "to_regclass('supabase_migrations.schema_migrations') IS NOT NULL"; fi);
      "
  )"

  IFS='|' read -r public_schema_exists public_table_count public_tables_without_rls policy_count migrations_table_exists <<<"${validation}"

  if [[ "${public_schema_exists}" != "t" || ! "${public_table_count}" =~ ^[1-9][0-9]*$ ||
    "${public_tables_without_rls}" != "0" || ! "${policy_count}" =~ ^[1-9][0-9]*$ ||
    "${migrations_table_exists}" != "t" ]]; then
    echo "ERROR: post-restore semantic validation failed; RESTORE_DATABASE_ISOLATED_SUCCESS will not be printed" >&2
    exit 1
  fi
}

echo "restore-database-local: checking pg_trgm prerequisite on confirmed isolated target"
preflight_target_extensions
preflight_target_postgres_major

echo "restore-database-local: resetting application schemas ${MANIFEST_SCHEMAS_CSV} on confirmed isolated target"
reset_application_schemas

echo "restore-database-local: restoring application pre-data (schemas ${MANIFEST_SCHEMAS_CSV} and their objects)"
restore_application_section pre-data "${APPLICATION_PRE_DATA_RESTORE_LIST}"

echo "restore-database-local: restoring application data"
restore_application_section data "${PREFLIGHT_DIR}/application.list"

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
pg_restore \
  --dbname="${GESTCOPY_RESTORE_TARGET_URL}" \
  --section=post-data \
  --no-owner \
  --exit-on-error \
  --use-list="${APPLICATION_POST_DATA_RESTORE_LIST}" \
  "${APPLICATION_DUMP}"

echo "restore-database-local: validating restored target"
validate_restored_target
compare_recovery_fingerprint

echo "RESTORE_DATABASE_ISOLATED_SUCCESS"
