#!/usr/bin/env bash
# Idempotent repository bootstrap for Cloud Agent environments.
# Installs system tooling required to run the local Supabase stack plus the
# Next.js app, then installs JS dependencies. Safe to re-run.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/cloud-agent-common.sh
. "${SCRIPT_DIR}/cloud-agent-common.sh"
gestcopy_require_cloud_agent

SUPABASE_CLI_VERSION="${SUPABASE_CLI_VERSION:-2.117.0}"

log() { printf '\n[install] %s\n' "$*"; }

log "Installing system packages (docker, fuse-overlayfs, postgres client)"
export DEBIAN_FRONTEND=noninteractive
sudo apt-get update -qq
# fuse-overlayfs lets Docker's storage driver work inside the nested VM.
# docker.io provides dockerd/CLI; postgresql-client is handy for DB checks.
sudo apt-get install -y -qq docker.io fuse-overlayfs postgresql-client || true

if ! command -v supabase >/dev/null 2>&1; then
  log "Installing Supabase CLI ${SUPABASE_CLI_VERSION}"
  ARCH="$(dpkg --print-architecture)"
  TMP_DEB="$(mktemp --suffix=.deb)"
  curl -sSL -o "${TMP_DEB}" \
    "https://github.com/supabase/cli/releases/download/v${SUPABASE_CLI_VERSION}/supabase_${SUPABASE_CLI_VERSION}_linux_${ARCH}.deb"
  sudo dpkg -i "${TMP_DEB}"
  rm -f "${TMP_DEB}"
else
  log "Supabase CLI already installed: $(supabase --version)"
fi

log "Installing JS dependencies (npm ci)"
npm ci

log "Done."
