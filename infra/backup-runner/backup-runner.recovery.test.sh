#!/usr/bin/env bash
# B1.3 end-to-end recovery drill with real PostgreSQL tools (no secrets, no network
# beyond local Docker). Two disposable local Supabase stacks:
#
#   source  all repository migrations + recovery-fixture.sql
#   target  empty Supabase project (the isolated restore target)
#
# Runs the real runner image: backup-database.sh (rclone local remote, throwaway
# age key) → decrypt → restore-database-local.sh, then checks independently that
# the target reproduces the source in every application schema. Also proves that
# a recovery set missing a private schema is rejected before the target changes.
#
# Usage (repository root): bash infra/backup-runner/backup-runner.recovery.test.sh
# Optional: RECOVERY_SOURCE_PORT_PREFIX / RECOVERY_TARGET_PORT_PREFIX (3 digits,
# default 581 / 582), RECOVERY_STACK_SUFFIX (parallel runs), SUPABASE_CLI_VERSION,
# RECOVERY_KEEP_STACKS=true.
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RUNNER_DIR="${ROOT}/infra/backup-runner"
SUPABASE_CLI=(npx --yes "supabase@${SUPABASE_CLI_VERSION:-2.117.0}")
SOURCE_ID="gestcopy-recovery-source${RECOVERY_STACK_SUFFIX:-}"
TARGET_ID="gestcopy-recovery-target${RECOVERY_STACK_SUFFIX:-}"
SOURCE_PREFIX="${RECOVERY_SOURCE_PORT_PREFIX:-581}"
TARGET_PREFIX="${RECOVERY_TARGET_PORT_PREFIX:-582}"
IMAGE=gestcopy-backup-runner:recovery-test
PRODUCTION_REF_FIXTURE=production-ref-fixture
SOURCE_URL="postgresql://postgres:postgres@supabase_db_${SOURCE_ID}:5432/postgres"
TARGET_URL="postgresql://postgres:postgres@supabase_db_${TARGET_ID}:5432/postgres"
EXCLUDED_SERVICES=gotrue,realtime,storage-api,imgproxy,kong,mailpit,postgrest,postgres-meta,studio,edge-runtime,logflare,vector,supavisor
TEST_COUNT=0

WORK="$(mktemp -d "${TMPDIR:-/tmp}/gestcopy-recovery-test.XXXXXX")"
cleanup() {
  local status=$?
  if [[ "${RECOVERY_KEEP_STACKS:-false}" != "true" ]]; then
    for stack in source target; do
      if [[ -d "${WORK}/${stack}" ]]; then
        (cd "${WORK}/${stack}" && "${SUPABASE_CLI[@]}" stop --no-backup >/dev/null 2>&1) || true
      fi
    done
    # Files written by the runner (uid 10001) may not be removable by this user.
    docker run --rm --user 0 -v "${WORK}:/work" "${IMAGE}" sh -c 'rm -rf /work/b2 /work/key /work/plain' >/dev/null 2>&1 || true
    rm -rf "${WORK}" 2>/dev/null || true
  else
    echo "recovery-test: stacks and ${WORK} kept (RECOVERY_KEEP_STACKS=true)"
  fi
  exit "${status}"
}
trap cleanup EXIT

pass() {
  TEST_COUNT=$((TEST_COUNT + 1))
  printf 'ok %s - %s\n' "${TEST_COUNT}" "$1"
}

fail() {
  echo "not ok - $1" >&2
  exit 1
}

db() {
  local id="$1"
  shift
  docker exec -i "supabase_db_${id}" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -Atq "$@"
}

make_stack() {
  local name="$1" id="$2" prefix="$3" with_migrations="$4"
  mkdir -p "${WORK}/${name}/supabase"
  sed -E \
    -e "s/^project_id = .*/project_id = \"${id}\"/" \
    -e "s/(port = )543([0-9][0-9])/\\1${prefix}\\2/" \
    "${ROOT}/supabase/config.toml" >"${WORK}/${name}/supabase/config.toml"
  if [[ "${with_migrations}" == "true" ]]; then
    cp -R "${ROOT}/supabase/migrations" "${WORK}/${name}/supabase/migrations"
  fi
  (cd "${WORK}/${name}" && "${SUPABASE_CLI[@]}" start --exclude "${EXCLUDED_SERVICES}" >"${WORK}/${name}.start.log" 2>&1) \
    || { cat "${WORK}/${name}.start.log" >&2; fail "supabase start ${name}"; }
}

runner() {
  local network="$1"
  shift
  docker run --rm --network "${network}" -e PGSSLMODE=disable "$@"
}

restore_with() {
  local manifest="$1" application="$2"
  runner "supabase_network_${TARGET_ID}" \
    -v "${WORK}/plain:/restore:ro" \
    -e GESTCOPY_ALLOW_RESTORE=isolated-only \
    -e GESTCOPY_ALLOW_PUBLIC_RESET=isolated-only \
    -e GESTCOPY_RESTORE_TARGET_URL="${TARGET_URL}" \
    -e GESTCOPY_PRODUCTION_PROJECT_REF="${PRODUCTION_REF_FIXTURE}" \
    -e GESTCOPY_RESTORE_TARGET_PROJECT_REF="${TARGET_ID}" \
    "${IMAGE}" /app/scripts/restore-database-local.sh \
      --manifest "/restore/${manifest}" \
      --application "/restore/${application}" \
      --auth /restore/gestcopy-auth.dump \
      --migrations /restore/gestcopy-migrations.dump
}

# Fails the test if the isolated target was modified (sentinel dropped by a reset).
expect_target_untouched() {
  [[ "$(db "${TARGET_ID}" -c "SELECT to_regclass('public.recovery_sentinel') IS NOT NULL")" == "t" ]] \
    || fail "$1: target was modified before the recovery set was rejected"
}

expect_rejected() {
  local label="$1" expected="$2" manifest="$3" application="$4"
  if restore_with "${manifest}" "${application}" >"${WORK}/rejected.log" 2>&1; then
    cat "${WORK}/rejected.log" >&2
    fail "${label}: restore unexpectedly succeeded"
  fi
  grep -q -- "${expected}" "${WORK}/rejected.log" || { cat "${WORK}/rejected.log" >&2; fail "${label}: wrong error"; }
  ! grep -q _SUCCESS "${WORK}/rejected.log" || fail "${label}: success marker printed"
  expect_target_untouched "${label}"
  pass "${label}"
}

fingerprint_of() {
  local id="$1"
  shift
  {
    printf '%s\n' "SET search_path TO ''; SET row_security TO off;"
    bash -c 'source "$1"; shift; recovery_fingerprint_sql "$@"' _ \
      "${RUNNER_DIR}/scripts/recovery-contract.sh" "$@"
    printf '\n'
  } | db "${id}" | sed 's/^gestcopy-recovery-fingerprint|//' | jq -S .
}

for tool in docker jq npx; do
  command -v "${tool}" >/dev/null || fail "missing ${tool}"
done

echo "recovery-test: building runner image"
docker build -q -t "${IMAGE}" "${RUNNER_DIR}" >/dev/null

echo "recovery-test: starting source (all migrations) and empty target"
make_stack source "${SOURCE_ID}" "${SOURCE_PREFIX}" true
make_stack target "${TARGET_ID}" "${TARGET_PREFIX}" false
(cd "${WORK}/source" && "${SUPABASE_CLI[@]}" db reset --local --no-seed >"${WORK}/source.reset.log" 2>&1) \
  || { cat "${WORK}/source.reset.log" >&2; fail "source db reset"; }
db "${SOURCE_ID}" <"${RUNNER_DIR}/test/recovery-fixture.sql" >/dev/null
db "${TARGET_ID}" -c "CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions; CREATE TABLE public.recovery_sentinel ();" >/dev/null
pass 'source migrated and seeded; target is an empty Supabase project'

echo "recovery-test: backup with the real runner"
mkdir -p "${WORK}/b2" "${WORK}/key" "${WORK}/plain"
chmod 0777 "${WORK}/b2" "${WORK}/key" "${WORK}/plain"
docker run --rm -v "${WORK}/key:/key" "${IMAGE}" age-keygen -o /key/drill.key 2>"${WORK}/key/public.txt"
AGE_RECIPIENT="$(sed -n 's/^Public key: //p' "${WORK}/key/public.txt")"
[[ "${AGE_RECIPIENT}" == age1* ]] || fail "throwaway age key"
runner "supabase_network_${SOURCE_ID}" \
  -v "${WORK}/b2:/backups/b2" \
  -e GESTCOPY_DATABASE_URL="${SOURCE_URL}" \
  -e GESTCOPY_BACKUP_AGE_RECIPIENT="${AGE_RECIPIENT}" \
  -e RCLONE_CONFIG_B2_TYPE=local \
  -e RCLONE_CONFIG_B2_ACCOUNT=unused \
  -e RCLONE_CONFIG_B2_KEY=unused \
  -e GESTCOPY_B2_BUCKET=/backups/b2 \
  "${IMAGE}" /app/scripts/backup-database.sh >"${WORK}/backup.log" 2>&1 \
  || { cat "${WORK}/backup.log" >&2; fail "backup-database.sh"; }
grep -q DATABASE_BACKUP_SUCCESS "${WORK}/backup.log" || fail "backup success marker"
SET_DIR="$(dirname "$(find "${WORK}/b2/database" -name manifest.json | head -n1)")"
MANIFEST="${SET_DIR}/manifest.json"
jq -e '.version == "2" and .status == "complete" and (.artifacts | length == 3)' "${MANIFEST}" >/dev/null \
  || fail "manifest v2"
SCHEMAS=()
while IFS= read -r schema; do
  SCHEMAS+=("${schema}")
done < <(jq -r '.application_schemas[]' "${MANIFEST}")
for required in public files_private imports_private kiosk_private; do
  jq -e --arg schema "${required}" '(.application_schemas | index($schema)) != null and .recovery_contract.schemas[$schema].tables > 0' \
    "${MANIFEST}" >/dev/null || fail "manifest lacks ${required}"
done
EXPECTED_SCHEMAS="$(db "${SOURCE_ID}" -c "SELECT string_agg(nspname, ',' ORDER BY nspname COLLATE \"C\") FROM pg_namespace WHERE nspname IN ('public') OR nspname LIKE '%\\_private'")"
[[ "$(jq -r '.application_schemas | join(",")' "${MANIFEST}")" == "${EXPECTED_SCHEMAS}" ]] \
  || fail "manifest schemas differ from the source catalog (${EXPECTED_SCHEMAS})"
pass "backup lists every application schema: ${EXPECTED_SCHEMAS}"

for artifact in application auth migrations; do
  docker run --rm -v "${SET_DIR}:/set:ro" -v "${WORK}/key:/key:ro" -v "${WORK}/plain:/plain" "${IMAGE}" \
    age -d -i /key/drill.key -o "/plain/gestcopy-${artifact}.dump" "/set/gestcopy-${artifact}.dump.age"
done
cp "${MANIFEST}" "${WORK}/plain/manifest.json"

echo "recovery-test: recovery sets that omit a private schema are rejected"
# Legacy shape (the defect): public-only archive with a version 1 manifest.
runner "supabase_network_${SOURCE_ID}" -v "${WORK}/plain:/plain" "${IMAGE}" \
  pg_dump "${SOURCE_URL}" --format=custom --no-owner --no-subscriptions --schema=public \
  --file=/plain/legacy-public-only.dump
jq '.version = "1" | del(.application_schemas, .recovery_contract)' "${MANIFEST}" >"${WORK}/plain/manifest-v1.json"
expect_rejected 'legacy public-only set (manifest v1) is rejected before the target changes' \
  'is not a multi-schema recovery set' manifest-v1.json legacy-public-only.dump

# Archive missing imports_private under a valid v2 manifest.
OMIT_ARGS=()
for schema in "${SCHEMAS[@]}"; do
  [[ "${schema}" == imports_private ]] || OMIT_ARGS+=("--schema=${schema}")
done
runner "supabase_network_${SOURCE_ID}" -v "${WORK}/plain:/plain" "${IMAGE}" \
  pg_dump "${SOURCE_URL}" --format=custom --no-owner --no-subscriptions "${OMIT_ARGS[@]}" \
  --file=/plain/without-imports-private.dump
expect_rejected 'archive without imports_private is rejected before the target changes' \
  'application archive does not define schema imports_private' manifest.json without-imports-private.dump

# Manifest that leaves a required private schema out.
jq '.application_schemas -= ["imports_private"] | del(.recovery_contract.schemas.imports_private)' \
  "${MANIFEST}" >"${WORK}/plain/manifest-without-imports-private.json"
expect_rejected 'manifest without imports_private is rejected before the target changes' \
  'manifest does not declare required application schema imports_private' \
  manifest-without-imports-private.json gestcopy-application.dump

echo "recovery-test: full isolated restore"
restore_with manifest.json gestcopy-application.dump >"${WORK}/restore.log" 2>&1 \
  || { cat "${WORK}/restore.log" >&2; fail "restore-database-local.sh"; }
grep -q 'recovery fingerprint matches' "${WORK}/restore.log" || fail "helper fingerprint check"
grep -q RESTORE_DATABASE_ISOLATED_SUCCESS "${WORK}/restore.log" || fail "restore success marker"
pass 'restore succeeds and the helper reports a matching recovery fingerprint'

# Independent of the helper: live source and restored target, same contract.
fingerprint_of "${SOURCE_ID}" "${SCHEMAS[@]}" >"${WORK}/source.fingerprint.json"
fingerprint_of "${TARGET_ID}" "${SCHEMAS[@]}" >"${WORK}/target.fingerprint.json"
if ! cmp -s "${WORK}/source.fingerprint.json" "${WORK}/target.fingerprint.json"; then
  diff "${WORK}/source.fingerprint.json" "${WORK}/target.fingerprint.json" >&2 || true
  fail "independent fingerprint differs"
fi
pass 'independent fingerprint identical: rows, RLS, policies, ACL, SECURITY DEFINER, triggers, FKs, indexes'

CHECKS="SELECT concat_ws('|',
  (SELECT count(*) FROM imports_private.client_import_batches),
  (SELECT count(*) FROM imports_private.client_import_rows),
  (SELECT count(*) FROM files_private.storage_deletions),
  (SELECT count(*) FROM files_private.storage_deletion_events),
  (SELECT count(*) FROM kiosk_private.kiosk_rate_limits),
  (SELECT count(*) FROM kiosk_private.kiosk_request_permits),
  (SELECT import_batch_id FROM public.clients WHERE id = 'b1300000-0000-4000-8000-000000000031'),
  (SELECT count(*) FROM pg_trigger WHERE tgname = 'clients_import_origin_guard'),
  (SELECT count(*) FROM auth.users WHERE id = 'b1300000-0000-4000-8000-000000000001'),
  has_schema_privilege('anon', 'imports_private', 'USAGE'),
  has_schema_privilege('authenticated', 'files_private', 'USAGE'),
  has_schema_privilege('authenticated', 'kiosk_private', 'USAGE'),
  has_schema_privilege('anon', 'public', 'USAGE'),
  CASE WHEN to_regnamespace('billing_private') IS NULL THEN 'no-billing_private'
       ELSE (SELECT count(*)::text FROM pg_class c WHERE c.relnamespace = to_regnamespace('billing_private') AND c.relkind = 'r') END)"
SOURCE_CHECKS="$(db "${SOURCE_ID}" -c "${CHECKS}")"
TARGET_CHECKS="$(db "${TARGET_ID}" -c "${CHECKS}")"
[[ "${SOURCE_CHECKS}" == "${TARGET_CHECKS}" ]] || fail "fixture checks differ: ${SOURCE_CHECKS} vs ${TARGET_CHECKS}"
[[ "${TARGET_CHECKS}" == "1|1|1|1|1|1|b1300000-0000-4000-8000-000000000021|1|1|f|f|f|t|"* ]] \
  || fail "unexpected fixture state: ${TARGET_CHECKS}"
pass "private rows, cross-schema trigger/FK, auth user and API-role isolation restored (${TARGET_CHECKS##*|})"

if [[ " ${SCHEMAS[*]} " == *" billing_private "* ]]; then
  [[ "$(db "${TARGET_ID}" -c "SELECT (SELECT count(*) FROM billing_private.internal_subscription_audit) > 0")" == "t" ]] \
    || fail "billing_private audit rows not restored"
  pass 'billing_private restored with its audit rows'
fi

printf '1..%s\n' "${TEST_COUNT}"
echo "RECOVERY_TEST_SUCCESS"
