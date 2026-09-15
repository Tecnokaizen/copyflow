#!/usr/bin/env bash
# Shared helpers for the Cursor Cloud Agent environment scripts.
# Source this file; do not execute it directly.

# gestcopy_require_cloud_agent
# Aborts unless we are running inside a Cursor Cloud Agent VM.
#
# Why: cloud-agent-install.sh / cloud-agent-start.sh perform host-level actions
# (install system packages, start dockerd, change /etc/docker/daemon.json,
# adjust sysctl/network). Running them on a developer laptop or a normal server
# would be intrusive. This guard makes accidental execution fail fast.
#
# Detection uses several independent signals so it keeps working even if one of
# them changes:
#   - CURSOR_AGENT=1                (env var injected in the agent VM)
#   - /run/cursor/api.sock          (agent control socket)
#   - /run/cursor or /opt/cursor/cloud-agent-tools (agent-only paths)
#
# Conscious override for debugging: export GESTCOPY_ENV_ALLOW_UNSAFE=1
gestcopy_require_cloud_agent() {
  if [ "${GESTCOPY_ENV_ALLOW_UNSAFE:-0}" = "1" ]; then
    echo "[guard] GESTCOPY_ENV_ALLOW_UNSAFE=1 set — skipping Cloud Agent check (debug mode)." >&2
    return 0
  fi

  if [ "${CURSOR_AGENT:-}" = "1" ] \
    || [ -S /run/cursor/api.sock ] \
    || [ -d /run/cursor ] \
    || [ -d /opt/cursor/cloud-agent-tools ]; then
    return 0
  fi

  cat >&2 <<'MSG'
ERROR: This script only runs inside a Cursor Cloud Agent VM.

It performs host-level changes (installs packages, starts a Docker daemon,
edits /etc/docker/daemon.json and network sysctls) that must NOT run on a
developer machine or a normal server.

If you really know what you are doing (conscious debugging), re-run with:
    GESTCOPY_ENV_ALLOW_UNSAFE=1 <command>
MSG
  exit 1
}
