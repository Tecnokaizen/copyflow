# Cursor Environment (Cloud Agents)

## What it is

An **isolated, ephemeral environment for Cursor Cloud Agents** that runs Gestcopy
end-to-end: the Next.js app plus a full **local Supabase stack** (Postgres,
Auth, PostgREST, Studio) rebuilt purely from the repo migrations.

It exists so an agent can: bring up the app, rebuild Supabase from migrations,
run tests/smoke tests, and validate changes **before** they reach Vercel Preview
and a human review. It is **not** a replacement for production.

> It runs **only inside a Cloud Agent VM**. The setup scripts refuse to run
> elsewhere (see the guard below) because they make host-level changes.

## Why Docker + local Supabase

The app depends on Supabase (Auth, RLS, RPCs). To exercise it faithfully we run
the real Supabase services locally as Docker containers via the Supabase CLI
(`supabase start`), applying the repo's SQL migrations to an empty database.
Nothing connects to the remote/production Supabase.

## Special Docker / network tweaks (and why)

The Cloud Agent VM is a nested environment where Docker needs two adjustments,
applied in `scripts/cloud-agent-start.sh`:

- **Storage driver `fuse-overlayfs`** — the default `overlayfs` cannot extract
  image whiteout files here (`operation not permitted`).
- **Firewall backend `iptables`** + **`net.bridge.bridge-nf-call-iptables=0`** —
  Docker 29's nftables backend fails to program rules, and bridged traffic
  between containers is otherwise dropped. Disabling bridge netfilter lets
  same-bridge container traffic flow (verified sufficient without a broad
  `FORWARD ACCEPT`).

The Docker socket is scoped to the agent's login group (mode `660`), not made
world-writable. All of this is confined to the ephemeral, single-tenant VM.

## Isolation guarantees

- **Never touches remote Supabase**: the project is not linked; there are no
  `supabase link` / `db push` / `db reset --linked` / `--db-url` commands.
  `.env.local` points at `http://127.0.0.1:54321`.
- **Never runs on Vercel or a laptop**: Vercel ignores `.cursor/` and these
  scripts; the guard aborts execution outside a Cloud Agent VM.
- **No real secrets**: only the well-known local Supabase dev keys, generated at
  runtime into `.env.local` (git-ignored).

## How it starts

Defined in `.cursor/environment.json`:

- `install` → `scripts/cloud-agent-install.sh` (system packages, Supabase CLI, `npm ci`)
- `start` → `scripts/cloud-agent-start.sh` (Docker daemon, network, `supabase start`, `.env.local`)
- terminal `next-dev` → `npm run dev`

Both scripts are idempotent. For conscious local debugging only, bypass the
guard with `GESTCOPY_ENV_ALLOW_UNSAFE=1`.
