#!/usr/bin/env bash
set -Eeuo pipefail

acquire_runner_lock() {
  local lock_status
  exec 9>"${GESTCOPY_BACKUP_LOCK_FILE:-/tmp/gestcopy-backup-runner.lock}"
  if flock --nonblock --conflict-exit-code 75 9; then
    return 0
  else
    lock_status=$?
    if [[ "${lock_status}" -eq 75 ]]; then
      echo "BACKUP_RUNNER_BUSY: another copy or verification is running; retry later" >&2
    else
      echo "ERROR: unable to acquire backup runner lock" >&2
    fi
    exit "${lock_status}"
  fi
}
