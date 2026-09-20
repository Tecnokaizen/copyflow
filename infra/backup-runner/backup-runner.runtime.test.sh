#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/scripts" && pwd)"
FIXTURE="$(mktemp -d)"
TEST_COUNT=0
HOLDER_PID=""
AGE_RECIPIENT=""
FAKE_SNAPSHOT_ID="00000004-0000002A-1"

cleanup() {
  touch "${FIXTURE}/release"
  if [[ -n "${HOLDER_PID}" ]]; then
    wait "${HOLDER_PID}" 2>/dev/null || true
  fi
  # Snapshot exporters must not outlive the suite.
  if [[ -f "${FIXTURE}/exporter.pid" ]]; then
    while read -r pid; do
      kill "${pid}" 2>/dev/null || true
      wait "${pid}" 2>/dev/null || true
    done <"${FIXTURE}/exporter.pid"
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
: >"${FIXTURE}/exporter.pid"
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
    exit 91
    ;;
  copyto)
    src="$2"
    dest="$3"
    [[ "${dest}" == B2:fixture-backups/database/* ]]
    [[ " $* " != *"--delete"* ]]
    [[ " $* " != *" sync "* ]]
    base="$(basename "${src}")"
    remote_rel="${dest#B2:fixture-backups/}"
    mkdir -p "${STORE}/$(dirname "${remote_rel}")"
    seq_file="${FAKE_RCLONE_CALLS}.seq"
    count=0
    if [[ -f "${seq_file}" ]]; then
      count="$(cat "${seq_file}")"
    fi
    count=$((count + 1))
    printf '%s\n' "${count}" >"${seq_file}"
    printf 'db-copyto|%s|%s\n' "${count}" "${base}" >>"${FAKE_RCLONE_CALLS}"
    if [[ -n "${FAKE_RCLONE_FAIL_ON_BASENAME:-}" && "${base}" == "${FAKE_RCLONE_FAIL_ON_BASENAME}" ]]; then
      exit "${FAKE_RCLONE_EXIT_CODE:-7}"
    fi
    if [[ -n "${FAKE_RCLONE_FAIL_ON_N:-}" && "${count}" -eq "${FAKE_RCLONE_FAIL_ON_N}" ]]; then
      exit "${FAKE_RCLONE_EXIT_CODE:-7}"
    fi
    if [[ "${FAKE_RCLONE_EXIT_CODE:-0}" != "0" && -z "${FAKE_RCLONE_FAIL_ON_BASENAME:-}" && -z "${FAKE_RCLONE_FAIL_ON_N:-}" ]]; then
      exit "${FAKE_RCLONE_EXIT_CODE}"
    fi
    cp "${src}" "${STORE}/${remote_rel}"
    if [[ -n "${FAKE_RCLONE_CORRUPT_BASENAME:-}" && "${base}" == "${FAKE_RCLONE_CORRUPT_BASENAME}" ]]; then
      printf 'x' >>"${STORE}/${remote_rel}"
    fi
    exit 0
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
if [[ "${FAKE_PSQL_EXIT_CODE:-0}" != "0" ]]; then
  exit "${FAKE_PSQL_EXIT_CODE}"
fi

# One-shot probe mode (-c / -Atqc).
if [[ " $* " == *" -c "* || " $* " == *" -Atqc "* || "$*" == *"-Atqc"* ]]; then
  if [[ "$*" == *"SHOW server_version"* ]]; then
    printf '%s\n' "${FAKE_PG_VERSION:-17.4}"
    exit 0
  fi
  if [[ "$*" == *"select version()"* ]]; then
    printf 'PostgreSQL %s\n' "${FAKE_PG_VERSION:-17.4}"
    exit 0
  fi
  exit 0
fi

# Interactive / coproc snapshot exporter mode.
printf '%s\n' "${BASHPID}" >>"${FAKE_EXPORTER_PIDS:?}"
if [[ "${FAKE_SNAPSHOT_FAIL:-false}" == "true" ]]; then
  # Produce no snapshot id; backup must abort before pg_dump.
  while IFS= read -r line; do
    case "${line}" in
      COMMIT*|ROLLBACK*|'\\q'*) exit 0 ;;
    esac
  done
  exit 0
fi

exported=false
while IFS= read -r line; do
  case "${line}" in
    *pg_export_snapshot*)
      printf '%s\n' "${FAKE_SNAPSHOT_ID:-00000004-0000002A-1}"
      exported=true
      if [[ "${FAKE_EXPORTER_DIE_AFTER_SNAPSHOT:-false}" == "true" ]]; then
        exit 42
      fi
      ;;
    COMMIT*|ROLLBACK*|'\\q'*)
      exit 0
      ;;
  esac
done
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
snapshot=""
no_privileges=false
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
    --snapshot=*)
      snapshot="${args[$i]#--snapshot=}"
      ;;
    --snapshot)
      i=$((i + 1))
      snapshot="${args[$i]}"
      ;;
    --data-only)
      data_only=true
      ;;
    --no-privileges)
      no_privileges=true
      ;;
  esac
  i=$((i + 1))
done
[[ -n "${out}" ]]
[[ -n "${snapshot}" ]]
printf 'snapshot|%s|schema=%s|table=%s|data_only=%s|no_privileges=%s\n' \
  "${snapshot}" "${schema}" "${table}" "${data_only}" "${no_privileges}" >>"${FAKE_PG_DUMP_CALLS}.meta"
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
printf 'FAKE-PGDUMP|%s|%s\n' "${payload}" "$(date -u +%Y%m%d%H%M%S)" >"${out}"
exit 0
MOCK
chmod 0755 "${FIXTURE}/bin/pg_dump"

cat >"${FIXTURE}/bin/pg_restore" <<'MOCK'
#!/usr/bin/env bash
set -Eeuo pipefail
if [[ -n "${FAKE_PG_RESTORE_CALLS:-}" ]]; then
  section="full"
  data_only=false
  no_privileges=false
  args=("$@")
  i=0
  while [[ ${i} -lt ${#args[@]} ]]; do
    case "${args[$i]}" in
      --section=*) section="${args[$i]#--section=}" ;;
      --section) i=$((i + 1)); section="${args[$i]}" ;;
      --data-only) data_only=true ;;
      --no-privileges) no_privileges=true ;;
    esac
    i=$((i + 1))
  done
  if [[ "${data_only}" == "true" ]]; then
    section="data-only"
  fi
  printf 'pg_restore|%s|no_privileges=%s\n' "${section}" "${no_privileges}" >>"${FAKE_PG_RESTORE_CALLS}"
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
    FAKE_EXPORTER_PIDS="${FIXTURE}/exporter.pid" \
    FAKE_SNAPSHOT_ID="${FAKE_SNAPSHOT_ID}" \
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

remote_has_manifest() {
  find "${FIXTURE}/remote" -name manifest.json 2>/dev/null | grep -q .
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

# --- Database backup suite (B1.3 hardening) ---

: >"${FIXTURE}/psql-calls"
: >"${FIXTURE}/pgdump-calls"
: >"${FIXTURE}/calls"
: >"${FIXTURE}/exporter.pid"
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

: >"${FIXTURE}/pgdump-calls"
expect_failure 1 backup-database.sh FAKE_SNAPSHOT_FAIL=true
[[ ! -s "${FIXTURE}/pgdump-calls" ]]
pass 'backup-database: snapshot acquisition failure runs no pg_dump'

: >"${FIXTURE}/pgdump-calls"
if run_script backup-database.sh FAKE_EXPORTER_DIE_AFTER_SNAPSHOT=true >"${FIXTURE}/failure" 2>&1; then
  echo "Expected exporter death failure" >&2
  cat "${FIXTURE}/failure" >&2
  exit 1
fi
! grep -q '_SUCCESS' "${FIXTURE}/failure"
grep -q 'snapshot exporter terminated unexpectedly\|exited before dumps' "${FIXTURE}/failure"
pass 'backup-database: exporter death during dumps fails without success'

expect_failure 11 backup-database.sh FAKE_PG_DUMP_EXIT_CODE=11
pass 'backup-database: pg_dump failure propagates without success'

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
! grep -q 'db-copyto|' "${FIXTURE}/calls"
rm -f "${FIXTURE}/bin/age"
pass 'backup-database: encryption failure propagates without success'

for n in 1 2 3; do
  : >"${FIXTURE}/calls"
  rm -f "${FIXTURE}/calls.seq"
  rm -rf "${FIXTURE}/remote"
  mkdir -p "${FIXTURE}/remote"
  expect_failure 7 backup-database.sh FAKE_RCLONE_FAIL_ON_N="${n}" FAKE_RCLONE_EXIT_CODE=7
  ! remote_has_manifest
  pass "backup-database: rclone fail on artifact ${n} leaves no remote manifest"
done

: >"${FIXTURE}/calls"
rm -f "${FIXTURE}/calls.seq"
rm -rf "${FIXTURE}/remote"
mkdir -p "${FIXTURE}/remote"
if run_script backup-database.sh FAKE_RCLONE_CORRUPT_BASENAME=gestcopy-auth.dump.age >"${FIXTURE}/failure" 2>&1; then
  echo "Expected size mismatch failure" >&2
  cat "${FIXTURE}/failure" >&2
  exit 1
fi
! grep -q '_SUCCESS' "${FIXTURE}/failure"
! remote_has_manifest
pass 'backup-database: remote size mismatch leaves no remote manifest'

: >"${FIXTURE}/psql-calls"
: >"${FIXTURE}/pgdump-calls"
: >"${FIXTURE}/pgdump-calls.meta"
: >"${FIXTURE}/calls"
: >"${FIXTURE}/exporter.pid"
rm -f "${FIXTURE}/calls.seq"
rm -rf "${FIXTURE}/remote"
mkdir -p "${FIXTURE}/remote"
run_script backup-database.sh >"${FIXTURE}/db-output"
grep -q DATABASE_BACKUP_SUCCESS "${FIXTURE}/db-output"
! grep -F 'postgresql://fixture:secret@fixture.invalid:5432/postgres' "${FIXTURE}/db-output"
grep -q -- '--schema=public' "${FIXTURE}/pgdump-calls"
grep -q -- '--schema=auth' "${FIXTURE}/pgdump-calls"
grep -q 'supabase_migrations.schema_migrations' "${FIXTURE}/pgdump-calls"

# All three dumps share the exact same snapshot id.
mapfile -t snaps < <(awk -F'|' '/^snapshot\|/{print $2}' "${FIXTURE}/pgdump-calls.meta")
[[ "${#snaps[@]}" -eq 3 ]]
[[ "${snaps[0]}" == "${FAKE_SNAPSHOT_ID}" ]]
[[ "${snaps[0]}" == "${snaps[1]}" && "${snaps[1]}" == "${snaps[2]}" ]]
grep -q 'schema=public|.*|no_privileges=false' "${FIXTURE}/pgdump-calls.meta"
grep -q 'schema=auth|.*|no_privileges=true' "${FIXTURE}/pgdump-calls.meta"

# Manifest is the last uploaded object.
mapfile -t copy_order < <(awk -F'|' '/^db-copyto\|/{print $3}' "${FIXTURE}/calls")
[[ "${#copy_order[@]}" -eq 4 ]]
[[ "${copy_order[0]}" == "gestcopy-application.dump.age" ]]
[[ "${copy_order[1]}" == "gestcopy-auth.dump.age" ]]
[[ "${copy_order[2]}" == "gestcopy-migrations.dump.age" ]]
[[ "${copy_order[3]}" == "manifest.json" ]]

mapfile -t uploaded < <(find "${FIXTURE}/remote" -type f | sort)
[[ "${#uploaded[@]}" -eq 4 ]]
manifest="$(find "${FIXTURE}/remote" -name manifest.json | head -n1)"
jq -e '.encryption == "age"' "${manifest}" >/dev/null
jq -e '.consistency == "postgresql-exported-snapshot"' "${manifest}" >/dev/null
jq -e '.status == "complete"' "${manifest}" >/dev/null
jq -e '.artifacts | length == 3' "${manifest}" >/dev/null
! grep -Eiq 'password|secret|postgresql://|AGE-SECRET|access_key|@fixture|00000004' "${manifest}"
pass 'backup-database: happy path shares snapshot, uploads dumps then manifest'

! find "${FIXTURE}/remote" -name 'gestcopy-*.dump' | grep -q .
# No live exporter PIDs remain after success.
alive=0
if [[ -s "${FIXTURE}/exporter.pid" ]]; then
  while read -r pid; do
    if kill -0 "${pid}" 2>/dev/null; then
      alive=$((alive + 1))
    fi
  done <"${FIXTURE}/exporter.pid"
fi
[[ "${alive}" -eq 0 ]]
pass 'backup-database: plaintext cleaned and snapshot exporter not left running'

# --- Restore guards + section order ---

printf 'app\n' >"${FIXTURE}/restore/app.dump"
printf 'auth\n' >"${FIXTURE}/restore/auth.dump"
printf 'mig\n' >"${FIXTURE}/restore/mig.dump"

run_restore() {
  env -i PATH="${FIXTURE}/bin:${PATH}" HOME="${FIXTURE}" \
    FAKE_PG_RESTORE_CALLS="${FIXTURE}/pgrestore-calls" \
    "$@" bash "${SCRIPT_DIR}/restore-database-local.sh" \
      --application "${FIXTURE}/restore/app.dump" \
      --auth "${FIXTURE}/restore/auth.dump" \
      --migrations "${FIXTURE}/restore/mig.dump"
}

: >"${FIXTURE}/pgrestore-calls"
if ! run_restore \
  GESTCOPY_ALLOW_RESTORE=isolated-only \
  GESTCOPY_RESTORE_TARGET_URL='postgresql://postgres.isolatedref:secret@aws-0.pooler.supabase.com:5432/postgres' \
  GESTCOPY_PRODUCTION_PROJECT_REF=prodref123 \
  GESTCOPY_RESTORE_TARGET_PROJECT_REF=isolatedref \
  GESTCOPY_DATABASE_URL='postgresql://fixture:secret@fixture.invalid:5432/postgres' \
  >"${FIXTURE}/restore-out" 2>&1; then
  echo 'expected isolated restore success' >&2
  cat "${FIXTURE}/restore-out" >&2
  exit 1
fi
grep -q RESTORE_DATABASE_ISOLATED_SUCCESS "${FIXTURE}/restore-out"
mapfile -t restore_order < <(awk -F'|' '{print $2}' "${FIXTURE}/pgrestore-calls")
[[ "${#restore_order[@]}" -eq 5 ]]
[[ "${restore_order[0]}" == "pre-data" ]]
[[ "${restore_order[1]}" == "data" ]]
[[ "${restore_order[2]}" == "data-only" ]]
[[ "${restore_order[3]}" == "data-only" ]]
[[ "${restore_order[4]}" == "post-data" ]]
# application sections must not use --no-privileges; auth/migrations may.
grep -q 'pg_restore|pre-data|no_privileges=false' "${FIXTURE}/pgrestore-calls"
grep -q 'pg_restore|data|no_privileges=false' "${FIXTURE}/pgrestore-calls"
grep -q 'pg_restore|post-data|no_privileges=false' "${FIXTURE}/pgrestore-calls"
pass 'restore: isolated happy path uses section order without application --no-privileges'

if run_restore \
  GESTCOPY_ALLOW_RESTORE=yes-please \
  GESTCOPY_RESTORE_TARGET_URL='postgresql://postgres.isolatedref@host/db' \
  GESTCOPY_PRODUCTION_PROJECT_REF=prodref123 \
  GESTCOPY_RESTORE_TARGET_PROJECT_REF=isolatedref \
  >"${FIXTURE}/restore-out" 2>&1; then
  echo 'expected restore to reject missing isolated-only' >&2
  exit 1
fi
! grep -q _SUCCESS "${FIXTURE}/restore-out"
pass 'restore: requires isolated-only confirmation'

: >"${FIXTURE}/pgrestore-calls"
if run_restore \
  GESTCOPY_ALLOW_RESTORE=isolated-only \
  GESTCOPY_RESTORE_TARGET_URL='postgresql://postgres.isolatedref@host/db' \
  GESTCOPY_PRODUCTION_PROJECT_REF=prodref123 \
  GESTCOPY_RESTORE_TARGET_PROJECT_REF=prodref123 \
  >"${FIXTURE}/restore-out" 2>&1; then
  echo 'expected production ref equality reject' >&2
  exit 1
fi
grep -q 'restore target resolves to Production project ref' "${FIXTURE}/restore-out"
[[ ! -s "${FIXTURE}/pgrestore-calls" ]]
! grep -qi 'postgresql://' "${FIXTURE}/restore-out"
pass 'restore: production ref == target ref fails before pg_restore'

: >"${FIXTURE}/pgrestore-calls"
if run_restore \
  GESTCOPY_ALLOW_RESTORE=isolated-only \
  GESTCOPY_RESTORE_TARGET_URL='postgresql://postgres.prodref123.supabase.co/postgres' \
  GESTCOPY_PRODUCTION_PROJECT_REF=prodref123 \
  GESTCOPY_RESTORE_TARGET_PROJECT_REF=isolatedref \
  >"${FIXTURE}/restore-out" 2>&1; then
  echo 'expected URL containing production ref to fail' >&2
  exit 1
fi
grep -q 'restore target resolves to Production project ref' "${FIXTURE}/restore-out"
[[ ! -s "${FIXTURE}/pgrestore-calls" ]]
pass 'restore: target URL containing production ref fails'

: >"${FIXTURE}/pgrestore-calls"
# Absent GESTCOPY_DATABASE_URL must not weaken project-ref guards.
if run_restore \
  GESTCOPY_ALLOW_RESTORE=isolated-only \
  GESTCOPY_RESTORE_TARGET_URL='postgresql://postgres.prodref123.supabase.co/postgres' \
  GESTCOPY_PRODUCTION_PROJECT_REF=prodref123 \
  GESTCOPY_RESTORE_TARGET_PROJECT_REF=isolatedref \
  >"${FIXTURE}/restore-out" 2>&1; then
  echo 'expected project-ref guard without DATABASE_URL' >&2
  exit 1
fi
grep -q 'restore target resolves to Production project ref' "${FIXTURE}/restore-out"
[[ ! -s "${FIXTURE}/pgrestore-calls" ]]
pass 'restore: project-ref guards work without GESTCOPY_DATABASE_URL'

if run_restore \
  GESTCOPY_ALLOW_RESTORE=isolated-only \
  GESTCOPY_DATABASE_URL='postgresql://same@fixture.invalid/db' \
  GESTCOPY_RESTORE_TARGET_URL='postgresql://same@fixture.invalid/db' \
  GESTCOPY_PRODUCTION_PROJECT_REF=prodref123 \
  GESTCOPY_RESTORE_TARGET_PROJECT_REF=isolatedref \
  >"${FIXTURE}/restore-out" 2>&1; then
  echo 'expected restore to reject source==target' >&2
  exit 1
fi
grep -q 'must not equal GESTCOPY_DATABASE_URL' "${FIXTURE}/restore-out"
! grep -q _SUCCESS "${FIXTURE}/restore-out"
pass 'restore: rejects source == target URL'

printf '1..%s\n' "${TEST_COUNT}"
