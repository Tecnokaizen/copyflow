#!/usr/bin/env bash
# Per-boot runtime initialization for Cloud Agent environments.
# Brings up the Docker daemon (configured for this nested VM), starts the local
# Supabase stack, and writes .env.local so the Next.js app can reach it.
# Idempotent: detects an already-running daemon/stack and reconciles instead of
# duplicating work.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/cloud-agent-common.sh
. "${SCRIPT_DIR}/cloud-agent-common.sh"
gestcopy_require_cloud_agent

WORKSPACE_DIR="${WORKSPACE_DIR:-$(cd "${SCRIPT_DIR}/.." && pwd)}"
cd "${WORKSPACE_DIR}"

log() { printf '\n[start] %s\n' "$*"; }

# --- Docker daemon --------------------------------------------------------
# The default overlayfs storage driver cannot extract image whiteout files in
# this nested environment, and Docker 29's nftables firewall backend fails to
# program rules. Use fuse-overlayfs + the iptables backend instead.
log "Configuring Docker daemon"
sudo mkdir -p /etc/docker
echo '{"storage-driver":"fuse-overlayfs","firewall-backend":"iptables"}' \
  | sudo tee /etc/docker/daemon.json >/dev/null

if ! sudo docker info >/dev/null 2>&1; then
  log "Starting dockerd"
  sudo rm -f /var/run/docker.pid
  sudo bash -c 'nohup dockerd > /var/log/dockerd.log 2>&1 &'
  for _ in $(seq 1 30); do
    sudo docker info >/dev/null 2>&1 && break
    sleep 1
  done
fi

# Grant the agent user access to the Docker socket WITHOUT making it
# world-writable (avoids `chmod 666`).
#
# Ideally we would rely on the `docker` group, but the Cloud Agent's long-lived
# shells are started before this script runs and do not refresh their
# supplementary groups mid-session, so a fresh `usermod -aG docker` would not
# take effect for the current agent. We therefore scope the socket to the
# agent's *primary* login group (mode 660) — reachable by the current sessions
# yet not open to every account on the box. We still add the user to the
# `docker` group so future login shells work the conventional way.
log "Granting Docker socket access to the agent user (group-scoped, not world)"
sudo groupadd -f docker || true
sudo usermod -aG docker "$(id -un)" || true
if [ -S /var/run/docker.sock ]; then
  sudo chown "root:$(id -gn)" /var/run/docker.sock
  sudo chmod 660 /var/run/docker.sock
fi

# --- Container networking --------------------------------------------------
# Bridged traffic between containers on the same Docker network is otherwise
# dropped by the iptables FORWARD chain. Disabling bridge-nf-call-iptables lets
# same-bridge L2 traffic flow directly (verified: containers reach each other
# even with FORWARD policy DROP), so we do NOT need a broad
# `iptables -P FORWARD ACCEPT`. `ip_forward` stays enabled because Docker needs
# it for published-port NAT. This is scoped to this ephemeral, single-tenant VM.
log "Enabling container-to-container networking"
sudo sysctl -w net.ipv4.ip_forward=1 >/dev/null
sudo sysctl -w net.bridge.bridge-nf-call-iptables=0 >/dev/null 2>&1 || true
sudo sysctl -w net.bridge.bridge-nf-call-ip6tables=0 >/dev/null 2>&1 || true

# --- Supabase local stack --------------------------------------------------
if supabase status >/dev/null 2>&1; then
  log "Supabase already running"
else
  log "Starting Supabase local stack (this pulls images on first run)"
  supabase start
fi

# --- App environment file --------------------------------------------------
if [ ! -f .env.local ]; then
  log "Writing .env.local"
  PUBLISHABLE_KEY="$(supabase status -o env 2>/dev/null | sed -n 's/^ANON_KEY=//p' | tr -d '"')"
  # Newer CLIs expose a publishable key; fall back to the anon key otherwise.
  PUB="$(supabase status -o env 2>/dev/null | sed -n 's/^PUBLISHABLE_KEY=//p' | tr -d '"')"
  [ -n "${PUB}" ] && PUBLISHABLE_KEY="${PUB}"
  cat > .env.local <<EOF
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${PUBLISHABLE_KEY}
APP_BASE_URL=http://localhost:3000
EMAIL_TRANSPORT=console
EOF
else
  log ".env.local already present; leaving it untouched"
fi

log "Environment ready. API: http://127.0.0.1:54321  Studio: http://127.0.0.1:54323"
