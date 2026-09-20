#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/scripts" && pwd)"
FIXTURE="$(mktemp -d)"
TEST_COUNT=0
HOLDER_PID=""

cleanup() {
  touch "${FIXTURE}/release"
  if [[ -n "${HOLDER_PID}" ]]; then
    wait "${HOLDER_PID}" 2>/dev/null || true
  fi
  rm -rf "${FIXTURE}"
}
trap cleanup EXIT

command -v flock >/dev/null
mkdir -p "${FIXTURE}/bin"
cat >"${FIXTURE}/bin/rclone" <<'MOCK'
#!/usr/bin/env bash
set -Eeuo pipefail
[[ "$2" == "R2:fixture-origin" ]]
[[ "$3" == "B2:fixture-backups/files" ]]
case "$1" in
  copy) [[ " $* " != *" --download "* ]] ;;
  check) [[ " $* " == *" --one-way "* && " $* " == *" --download "* ]] ;;
  *) exit 91 ;;
esac
[[ " $* " != *"--delete"* ]]
printf '%s|%s|%s|%s\n' "$1" "${RCLONE_CONFIG_R2_REGION-unset}" \
  "${RCLONE_CONFIG_R2_NO_CHECK_BUCKET-unset}" "${RCLONE_CONFIG_B2_HARD_DELETE-unset}" >>"${FAKE_RCLONE_CALLS}"
if [[ "${FAKE_RCLONE_HOLD:-false}" == "true" ]]; then
  printf '%s\n' "${BASHPID}" >"${FAKE_RCLONE_READY}"
  while [[ ! -f "${FAKE_RCLONE_RELEASE}" ]]; do sleep 0.05; done
fi
exit "${FAKE_RCLONE_EXIT_CODE:-0}"
MOCK
chmod 0755 "${FIXTURE}/bin/rclone"

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
    FAKE_RCLONE_RELEASE="${FIXTURE}/release" "$@" bash "${SCRIPT_DIR}/${script}"
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
    exit 1
  else
    status=$?
  fi
  [[ "${status}" -eq "${expected}" ]]
  ! grep -q '_SUCCESS' "${FIXTURE}/failure"
}

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
pass 'hourly orchestrator only copies, without downloading a full check'

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
  for contender in backup-all.sh backup-files.sh verify-files.sh; do
    expect_failure 75 "${contender}"
    grep -q BACKUP_RUNNER_BUSY "${FIXTURE}/failure"
    [[ "$(wc -l <"${FIXTURE}/calls")" -eq 1 ]]
    pass "${holder} excludes ${contender} before it reaches rclone"
  done
  touch "${FIXTURE}/release"
  wait "${HOLDER_PID}"
  HOLDER_PID=""
  run_script backup-files.sh >"${FIXTURE}/output"
  pass "${holder}: a subsequent copy can acquire the released lock"
done

rm -f "${FIXTURE}/ready" "${FIXTURE}/release"
run_script backup-files.sh FAKE_RCLONE_HOLD=true >"${FIXTURE}/holder" 2>&1 &
HOLDER_PID=$!
for attempt in {1..100}; do
  [[ ! -s "${FIXTURE}/ready" ]] || break
  sleep 0.05
done
[[ -s "${FIXTURE}/ready" ]]
kill -TERM "$(cat "${FIXTURE}/ready")"
if wait "${HOLDER_PID}"; then exit 1; fi
HOLDER_PID=""
! grep -q BACKUP_FILES_SUCCESS "${FIXTURE}/holder"
run_script verify-files.sh >"${FIXTURE}/output"
pass 'interrupted transfer fails without success and releases the lock'

printf '1..%s\n' "${TEST_COUNT}"
