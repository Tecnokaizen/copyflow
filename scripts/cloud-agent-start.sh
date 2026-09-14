#!/usr/bin/env bash
# Per-boot runtime initialization for Cloud Agent environments.
# Brings up the Docker daemon (configured for this nested VM), starts the local
# Supabase stack, and writes .env.local so the Next.js app can reach it.
# Idempotent: detects an already-running daemon/stack and reconciles instead of
# duplicating work.
set -euo pipefail

WORKSPACE_DIR="${WORKSPACE_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
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
# Let the non-root user talk to the daemon without sudo.
sudo chmod 666 /var/run/docker.sock 2>/dev/null || true

# --- Container networking --------------------------------------------------
# Bridged traffic between containers on the same Docker network is otherwise
# dropped by the iptables FORWARD chain. Let same-bridge L2 traffic bypass
# iptables and default the FORWARD policy to ACCEPT.
log "Enabling container-to-container networking"
sudo sysctl -w net.ipv4.ip_forward=1 >/dev/null
sudo sysctl -w net.bridge.bridge-nf-call-iptables=0 >/dev/null 2>&1 || true
sudo sysctl -w net.bridge.bridge-nf-call-ip6tables=0 >/dev/null 2>&1 || true
sudo iptables -P FORWARD ACCEPT 2>/dev/null || true

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
