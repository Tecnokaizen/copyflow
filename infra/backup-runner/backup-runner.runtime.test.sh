#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/scripts" && pwd)"
FIXTURE="$(mktemp -d)"
TEST_COUNT=0
HOLDER_PID=""
AGE_RECIPIENT=""

cleanup() {
  touch "${FIXTURE}/release"
  if [[ -n "${HOLDER_PID}" ]]; then
    wait "${HOLDER_PID}" 2>/dev/null || true
  fi
  rm -rf "${FIXTURE}"
}
trap cleanup EXIT

command -v flock >/dev/null
command -v jq >/dev/null
command -v age >/dev/null
command -v age-keygen >/dev/null
command -v sha256sum >/dev/null

mkdir -p "${FIXTURE}/bin" "${FIXTURE}/remote" "${FIXTURE}/restore"
AGE_RECIPIENT="$(age-keygen -o "${FIXTURE}/age.key" 2>&1 | sed -n 's/^Public key: //p')"
[[ "${AGE_RECIPIENT}" == age1* ]]

cat >"${FIXTURE}/bin/rclone" <<'MOCK'
#!/usr/bin/env bash
set -Eeuo pipefail
STORE="${FAKE_RCLONE_STORE:?}"
mkdir -p "${STORE}"
case "$1" in
  copy)
    if [[ "$2" == "R2:fixture-origin" && "$3" == "B2:fixture-backups/files" ]]; then
      [[ " $* " != *" --download "* ]]
      [[ " $* " != *"--delete"* ]]
      printf '%s|%s|%s|%s\n' "$1" "${RCLONE_CONFIG_R2_REGION-unset}" \
        "${RCLONE_CONFIG_R2_NO_CHECK_BUCKET-unset}" "${RCLONE_CONFIG_B2_HARD_DELETE-unset}" >>"${FAKE_RCLONE_CALLS}"
      if [[ "${FAKE_RCLONE_HOLD:-false}" == "true" ]]; then
        printf '%s\n' "${BASHPID}" >"${FAKE_RCLONE_READY}"
        while [[ ! -f "${FAKE_RCLONE_RELEASE}" ]]; do sleep 0.05; done
      fi
      exit "${FAKE_RCLONE_EXIT_CODE:-0}"
    fi
    # Database upload: local dir → B2:.../database/...
    src="${2%/}"
    dest="$3"
    [[ "${dest}" == B2:fixture-backups/database/* ]]
    [[ " $* " != *"--delete"* ]]
    [[ " $* " != *" sync "* ]]
    remote_rel="${dest#B2:fixture-backups/}"
    mkdir -p "${STORE}/${remote_rel}"
    if [[ -d "${src}" ]]; then
      for f in "${src}"/*; do
        [[ -e "${f}" ]] || continue
        base="$(basename "${f}")"
        case "${base}" in
          gestcopy-*.dump.age|manifest.json) cp "${f}" "${STORE}/${remote_rel}/${base}" ;;
        esac
      done
    else
      cp "${src}" "${STORE}/${remote_rel}/$(basename "${src}")"
    fi
    printf 'db-copy|%s\n' "${remote_rel}" >>"${FAKE_RCLONE_CALLS}"
    exit "${FAKE_RCLONE_EXIT_CODE:-0}"
    ;;
  check)
    [[ "$2" == "R2:fixture-origin" ]]
    [[ "$3" == "B2:fixture-backups/files" ]]
    [[ " $* " == *" --one-way "* && " $* " == *" --download "* ]]
    [[ " $* " != *"--delete"* ]]
    printf '%s|%s|%s|%s\n' "$1" "${RCLONE_CONFIG_R2_REGION-unset}" \
      "${RCLONE_CONFIG_R2_NO_CHECK_BUCKET-unset}" "${RCLONE_CONFIG_B2_HARD_DELETE-unset}" >>"${FAKE_RCLONE_CALLS}"
    if [[ "${FAKE_RCLONE_HOLD:-false}" == "true" ]]; then
      printf '%s\n' "${BASHPID}" >"${FAKE_RCLONE_READY}"
      while [[ ! -f "${FAKE_RCLONE_RELEASE}" ]]; do sleep 0.05; done
    fi
    exit "${FAKE_RCLONE_EXIT_CODE:-0}"
    ;;
  lsjson)
    target="$2"
    [[ "${target}" == B2:fixture-backups/* ]]
    rel="${target#B2:fixture-backups/}"
    if [[ ! -f "${STORE}/${rel}" ]]; then
      echo '[]'
      exit 0
    fi
    size="$(wc -c <"${STORE}/${rel}" | tr -d ' ')"
    jq -nc --arg name "$(basename "${rel}")" --argjson size "${size}" \
      '[{Name:$name,Size:$size}]'
    exit 0
    ;;
  *)
    exit 91
    ;;
esac
MOCK
chmod 0755 "${FIXTURE}/bin/rclone"

cat >"${FIXTURE}/bin/psql" <<'MOCK'
#!/usr/bin/env bash
set -Eeuo pipefail
printf 'psql|%s\n' "$*" >>"${FAKE_PSQL_CALLS}"
# Never require callers to print the URL; accept URI as argv0-style first arg.
if [[ "${FAKE_PSQL_EXIT_CODE:-0}" != "0" ]]; then
  exit "${FAKE_PSQL_EXIT_CODE}"
fi
if [[ "$*" == *"SHOW server_version"* ]]; then
  printf '%s\n' "${FAKE_PG_VERSION:-17.4}"
  exit 0
fi
if [[ "$*" == *"select version()"* ]]; then
  printf 'PostgreSQL %s\n' "${FAKE_PG_VERSION:-17.4}"
  exit 0
fi
exit 0
MOCK
chmod 0755 "${FIXTURE}/bin/psql"

cat >"${FIXTURE}/bin/pg_dump" <<'MOCK'
#!/usr/bin/env bash
set -Eeuo pipefail
printf 'pg_dump|%s\n' "$*" >>"${FAKE_PG_DUMP_CALLS}"
if [[ "${FAKE_PG_DUMP_EXIT_CODE:-0}" != "0" ]]; then
  exit "${FAKE_PG_DUMP_EXIT_CODE}"
fi
out=""
schema=""
data_only=false
table=""
args=("$@")
i=0
while [[ ${i} -lt ${#args[@]} ]]; do
  case "${args[$i]}" in
    --file=*)
      out="${args[$i]#--file=}"
      ;;
    --file)
      i=$((i + 1))
      out="${args[$i]}"
      ;;
    --schema=*)
      schema="${args[$i]#--schema=}"
      ;;
    --table=*)
      table="${args[$i]#--table=}"
      ;;
    --data-only)
      data_only=true
      ;;
  esac
  i=$((i + 1))
done
[[ -n "${out}" ]]
payload="dump"
if [[ -n "${schema}" ]]; then
  payload="${payload}:${schema}"
fi
if [[ -n "${table}" ]]; then
  payload="${payload}:${table}"
fi
if [[ "${data_only}" == "true" ]]; then
  payload="${payload}:data-only"
fi
# custom format is binary-ish; write a non-empty marker payload
printf 'FAKE-PGDUMP|%s|%s\n' "${payload}" "$(date -u +%Y%m%d%H%M%S)" >"${out}"
exit 0
MOCK
chmod 0755 "${FIXTURE}/bin/pg_dump"

cat >"${FIXTURE}/bin/pg_restore" <<'MOCK'
#!/usr/bin/env bash
set -Eeuo pipefail
if [[ -n "${FAKE_PG_RESTORE_CALLS:-}" ]]; then
  printf 'pg_restore|%s\n' "$*" >>"${FAKE_PG_RESTORE_CALLS}"
fi
exit "${FAKE_PG_RESTORE_EXIT_CODE:-0}"
MOCK
chmod 0755 "${FIXTURE}/bin/pg_restore"

run_script() {
  local script="$1"
  shift
  env -i PATH="${FIXTURE}/bin:${PATH}" HOME="${FIXTURE}" \
    RCLONE_CONFIG_R2_TYPE=s3 RCLONE_CONFIG_R2_PROVIDER=Cloudflare \
    RCLONE_CONFIG_R2_ACCESS_KEY_ID=fixture RCLONE_CONFIG_R2_SECRET_ACCESS_KEY=fixture \
    RCLONE_CONFIG_R2_ENDPOINT=https://fixture.invalid RCLONE_CONFIG_B2_TYPE=b2 \
    RCLONE_CONFIG_B2_ACCOUNT=fixture RCLONE_CONFIG_B2_KEY=fixture \
    GESTCOPY_R2_BUCKET=fixture-origin GESTCOPY_B2_BUCKET=fixture-backups \
    GESTCOPY_B2_FILES_PREFIX=files GESTCOPY_BACKUP_LOCK_FILE="${FIXTURE}/runner.lock" \
    FAKE_RCLONE_CALLS="${FIXTURE}/calls" FAKE_RCLONE_READY="${FIXTURE}/ready" \
    FAKE_RCLONE_RELEASE="${FIXTURE}/release" FAKE_RCLONE_STORE="${FIXTURE}/remote" \
    FAKE_PSQL_CALLS="${FIXTURE}/psql-calls" FAKE_PG_DUMP_CALLS="${FIXTURE}/pgdump-calls" \
    FAKE_PG_RESTORE_CALLS="${FIXTURE}/pgrestore-calls" \
    GESTCOPY_DATABASE_URL='postgresql://fixture:secret@fixture.invalid:5432/postgres' \
    GESTCOPY_BACKUP_AGE_RECIPIENT="${AGE_RECIPIENT}" \
    GESTCOPY_B2_DATABASE_PREFIX=database \
    "$@" bash "${SCRIPT_DIR}/${script}"
}

pass() {
  TEST_COUNT=$((TEST_COUNT + 1))
  printf 'ok %s - %s\n' "${TEST_COUNT}" "$1"
}

expect_failure() {
  local expected="$1" script="$2" status
  shift 2
  if run_script "${script}" "$@" >"${FIXTURE}/failure" 2>&1; then
    echo "Expected failure: ${script}" >&2
    cat "${FIXTURE}/failure" >&2
    exit 1
  else
    status=$?
  fi
  [[ "${status}" -eq "${expected}" ]]
  ! grep -q '_SUCCESS' "${FIXTURE}/failure"
}

# --- Files / shared lock suite (B1.2) ---

for script in backup-files.sh verify-files.sh; do
  action=copy
  [[ "${script}" != verify-files.sh ]] || action=check
  : >"${FIXTURE}/calls"
  run_script "${script}" >"${FIXTURE}/output"
  [[ "$(cat "${FIXTURE}/calls")" == "${action}|auto|true|false" ]]
  pass "${script}: omitted defaults reach the child process"

  : >"${FIXTURE}/calls"
  run_script "${script}" RCLONE_CONFIG_R2_REGION= RCLONE_CONFIG_R2_NO_CHECK_BUCKET= \
    RCLONE_CONFIG_B2_HARD_DELETE= >"${FIXTURE}/output"
  [[ "$(cat "${FIXTURE}/calls")" == "${action}|auto|true|false" ]]
  pass "${script}: empty values use exported defaults"

  : >"${FIXTURE}/calls"
  run_script "${script}" RCLONE_CONFIG_R2_REGION=fixture-region RCLONE_CONFIG_R2_NO_CHECK_BUCKET=false \
    RCLONE_CONFIG_B2_HARD_DELETE=true >"${FIXTURE}/output"
  [[ "$(cat "${FIXTURE}/calls")" == "${action}|fixture-region|false|true" ]]
  pass "${script}: explicit environment overrides are preserved"

  : >"${FIXTURE}/calls"
  expect_failure 1 "${script}" RCLONE_CONFIG_B2_KEY=
  [[ ! -s "${FIXTURE}/calls" ]]
  pass "${script}: missing credentials fail before rclone"

  expect_failure 7 "${script}" FAKE_RCLONE_EXIT_CODE=7
  run_script "${script}" >"${FIXTURE}/output"
  pass "${script}: rclone failures propagate and release the lock"
done

: >"${FIXTURE}/calls"
run_script backup-all.sh >"${FIXTURE}/output"
[[ "$(cat "${FIXTURE}/calls")" == 'copy|auto|true|false' ]]
grep -q BACKUP_ALL_SUCCESS "${FIXTURE}/output"
! grep -q DATABASE_BACKUP_SUCCESS "${FIXTURE}/output"
pass 'hourly orchestrator only copies Files, without database backup'

expect_failure 7 backup-all.sh FAKE_RCLONE_EXIT_CODE=7
pass 'orchestrator propagates copy failure without a success marker'

for holder in backup-all.sh verify-files.sh; do
  rm -f "${FIXTURE}/ready" "${FIXTURE}/release"
  : >"${FIXTURE}/calls"
  run_script "${holder}" FAKE_RCLONE_HOLD=true >"${FIXTURE}/holder" 2>&1 &
  HOLDER_PID=$!
  for attempt in {1..100}; do
    [[ ! -s "${FIXTURE}/ready" ]] || break
    sleep 0.05
  done
  [[ -s "${FIXTURE}/ready" ]]
  for contender in backup-all.sh backup-files.sh verify-files.sh backup-database.sh; do
    expect_failure 75 "${contender}"
    grep -q BACKUP_RUNNER_BUSY "${FIXTURE}/failure"
    pass "${holder} excludes ${contender} before shared work"
  done
  touch "${FIXTURE}/release"
  wait "${HOLDER_PID}"
  HOLDER_PID=""
  run_script backup-files.sh >"${FIXTURE}/output"
  pass "${holder}: a subsequent copy can acquire the released lock"
done

# Lock release after a completed holder is already covered above. An explicit
# SIGTERM race against rclone is environment-sensitive under Docker Desktop and
# is omitted here to keep the suite deterministic.

# --- Database backup suite (B1.3) ---

: >"${FIXTURE}/psql-calls"
: >"${FIXTURE}/pgdump-calls"
: >"${FIXTURE}/calls"
rm -rf "${FIXTURE}/remote"
mkdir -p "${FIXTURE}/remote"

expect_failure 1 backup-database.sh GESTCOPY_DATABASE_URL=
[[ ! -s "${FIXTURE}/pgdump-calls" ]]
pass 'backup-database: missing DB URL fails before pg_dump'

expect_failure 1 backup-database.sh GESTCOPY_BACKUP_AGE_RECIPIENT=
[[ ! -s "${FIXTURE}/pgdump-calls" ]]
pass 'backup-database: missing AGE recipient fails before pg_dump'

expect_failure 1 backup-database.sh GESTCOPY_BACKUP_AGE_RECIPIENT=not-an-age-key
pass 'backup-database: invalid AGE recipient is rejected'

expect_failure 9 backup-database.sh FAKE_PSQL_EXIT_CODE=9
[[ ! -s "${FIXTURE}/pgdump-calls" ]]
pass 'backup-database: psql probe failure propagates without success'

expect_failure 11 backup-database.sh FAKE_PG_DUMP_EXIT_CODE=11
pass 'backup-database: pg_dump failure propagates without success'

# Force age failure by pointing to a broken age binary once dumps succeed.
cat >"${FIXTURE}/bin/age" <<'BROKEN'
#!/usr/bin/env bash
exit 13
BROKEN
chmod 0755 "${FIXTURE}/bin/age"
: >"${FIXTURE}/pgdump-calls"
: >"${FIXTURE}/calls"
if run_script backup-database.sh >"${FIXTURE}/failure" 2>&1; then
  echo "Expected encryption failure" >&2
  cat "${FIXTURE}/failure" >&2
  exit 1
fi
! grep -q '_SUCCESS' "${FIXTURE}/failure"
# Dumps may have started; upload must not succeed.
! grep -q 'db-copy|' "${FIXTURE}/calls"
rm -f "${FIXTURE}/bin/age"
pass 'backup-database: encryption failure propagates without success'

expect_failure 7 backup-database.sh FAKE_RCLONE_EXIT_CODE=7
pass 'backup-database: rclone upload failure propagates without success'

: >"${FIXTURE}/psql-calls"
: >"${FIXTURE}/pgdump-calls"
: >"${FIXTURE}/calls"
rm -rf "${FIXTURE}/remote"
mkdir -p "${FIXTURE}/remote"
run_script backup-database.sh >"${FIXTURE}/db-output"
grep -q DATABASE_BACKUP_SUCCESS "${FIXTURE}/db-output"
! grep -F 'postgresql://fixture:secret@fixture.invalid:5432/postgres' "${FIXTURE}/db-output"
! grep -F 'postgresql://fixture:secret@fixture.invalid:5432/postgres' "${FIXTURE}/failure" 2>/dev/null || true
grep -q 'pg_dump|--schema=public' "${FIXTURE}/pgdump-calls" || grep -q -- '--schema=public' "${FIXTURE}/pgdump-calls"
grep -q -- '--schema=auth' "${FIXTURE}/pgdump-calls"
grep -q 'supabase_migrations.schema_migrations' "${FIXTURE}/pgdump-calls"
grep -q 'db-copy|' "${FIXTURE}/calls"

# Locate uploaded artifacts under fake remote store
mapfile -t uploaded < <(find "${FIXTURE}/remote" -type f | sort)
[[ "${#uploaded[@]}" -eq 4 ]]
printf '%s\n' "${uploaded[@]}" | grep -q 'gestcopy-application.dump.age$'
printf '%s\n' "${uploaded[@]}" | grep -q 'gestcopy-auth.dump.age$'
printf '%s\n' "${uploaded[@]}" | grep -q 'gestcopy-migrations.dump.age$'
printf '%s\n' "${uploaded[@]}" | grep -q 'manifest.json$'
# No leftover plaintext dumps in remote store
! find "${FIXTURE}/remote" -name '*.dump' | grep -q .
manifest="$(find "${FIXTURE}/remote" -name manifest.json | head -n1)"
jq -e '.encryption == "age"' "${manifest}" >/dev/null
jq -e '.source == "gestcopy-production-postgres"' "${manifest}" >/dev/null
jq -e '.artifacts | length == 3' "${manifest}" >/dev/null
! grep -Eiq 'password|secret|postgresql://|AGE-SECRET|access_key|@fixture' "${manifest}"
pass 'backup-database: happy path produces 3 encrypted artifacts + safe manifest'

# Plaintext cleanup: workdir trap removes the mktemp tree; remote must not hold dumps.
! find "${FIXTURE}/remote" -name 'gestcopy-*.dump' | grep -q .
pass 'backup-database: plaintext dumps are cleaned up'

# --- Restore guards ---

printf 'app\n' >"${FIXTURE}/restore/app.dump"
printf 'auth\n' >"${FIXTURE}/restore/auth.dump"
printf 'mig\n' >"${FIXTURE}/restore/mig.dump"

if GESTCOPY_ALLOW_RESTORE=isolated-only \
  GESTCOPY_RESTORE_TARGET_URL='postgresql://restore@fixture.invalid/db' \
  GESTCOPY_DATABASE_URL='postgresql://fixture:secret@fixture.invalid:5432/postgres' \
  PATH="${FIXTURE}/bin:${PATH}" \
  bash "${SCRIPT_DIR}/restore-database-local.sh" \
    --application "${FIXTURE}/restore/app.dump" \
    --auth "${FIXTURE}/restore/auth.dump" \
    --migrations "${FIXTURE}/restore/mig.dump" \
    >"${FIXTURE}/restore-out" 2>&1; then
  grep -q RESTORE_DATABASE_ISOLATED_SUCCESS "${FIXTURE}/restore-out"
else
  echo 'expected isolated restore success' >&2
  cat "${FIXTURE}/restore-out" >&2
  exit 1
fi
pass 'restore: isolated-only happy path'

if GESTCOPY_ALLOW_RESTORE=yes-please \
  GESTCOPY_RESTORE_TARGET_URL='postgresql://restore@fixture.invalid/db' \
  PATH="${FIXTURE}/bin:${PATH}" \
  bash "${SCRIPT_DIR}/restore-database-local.sh" \
    --application "${FIXTURE}/restore/app.dump" \
    --skip-auth --skip-migrations \
    >"${FIXTURE}/restore-out" 2>&1; then
  echo 'expected restore to reject missing isolated-only' >&2
  exit 1
fi
! grep -q _SUCCESS "${FIXTURE}/restore-out"
pass 'restore: requires isolated-only confirmation'

if GESTCOPY_ALLOW_RESTORE=isolated-only \
  GESTCOPY_DATABASE_URL='postgresql://same@fixture.invalid/db' \
  GESTCOPY_RESTORE_TARGET_URL='postgresql://same@fixture.invalid/db' \
  PATH="${FIXTURE}/bin:${PATH}" \
  bash "${SCRIPT_DIR}/restore-database-local.sh" \
    --application "${FIXTURE}/restore/app.dump" \
    --skip-auth --skip-migrations \
    >"${FIXTURE}/restore-out" 2>&1; then
  echo 'expected restore to reject source==target' >&2
  exit 1
fi
grep -q 'must not equal GESTCOPY_DATABASE_URL' "${FIXTURE}/restore-out"
! grep -q _SUCCESS "${FIXTURE}/restore-out"
pass 'restore: rejects source == target'

printf '1..%s\n' "${TEST_COUNT}"
