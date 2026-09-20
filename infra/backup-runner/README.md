# Gestcopy backup runner (B1.2 — Files)

Versioned image + scripts for a **dedicated Coolify resource** that copies Gestcopy Files from Cloudflare R2 to an off-site Backblaze B2 bucket.

This directory is infrastructure only. It does **not** change Gestcopy app code, Supabase schema/RLS/RPC, Files V1 runtime, Vercel, or cloud APIs.

## Purpose

Automate a **platform-global** Files backup:

- Source: Cloudflare R2 bucket `gestcopy-files` (operative Files storage)
- Destination: Backblaze B2 bucket `gestcopy-backups-prod-eu` (independent off-site copy)
- Destination prefix: `files/` so object keys remain tenant-aware under `files/orders/{tenant_id}/{order_id}/{file_id}`

Backups are **not** per-tenant. One runner, one R2 origin, one B2 destination for the whole Gestcopy platform (same multi-tenant shared storage model as the app).

## Architecture

```
Cloudflare R2 (gestcopy-files)
        │
        │  rclone copy   ← additive only
        ▼
Backblaze B2 (gestcopy-backups-prod-eu)
        └── files/orders/{tenant_id}/{order_id}/{file_id}
```

- **B2 is off-site and independent** of Cloudflare (separate vendor / credential plane).
- B2 bucket Object Lock: **Compliance, 30 days** (configured on the bucket; this runner must not alter Object Lock).
- R2 credentials used at runtime are **Object Read only** on `gestcopy-files`.
- B2 Application Key is limited to `gestcopy-backups-prod-eu`.

### Why `copy`, never `sync`

`rclone sync` can delete destination objects that are missing on the source. That is incompatible with Object Lock / retention and with a durable backup.

**Do not use `rclone sync`.** Do not pass `--delete-*` flags.

## Required environment variables

Set these in Coolify (or local shell). **Values are not documented here.**

### Rclone remote `R2` (Cloudflare)

| Variable | Notes |
|----------|--------|
| `RCLONE_CONFIG_R2_TYPE` | `s3` |
| `RCLONE_CONFIG_R2_PROVIDER` | `Cloudflare` |
| `RCLONE_CONFIG_R2_ACCESS_KEY_ID` | secret |
| `RCLONE_CONFIG_R2_SECRET_ACCESS_KEY` | secret |
| `RCLONE_CONFIG_R2_ENDPOINT` | R2 S3 API endpoint |
| `RCLONE_CONFIG_R2_REGION` | usually `auto` |
| `RCLONE_CONFIG_R2_NO_CHECK_BUCKET` | usually `true` |

### Rclone remote `B2` (Backblaze)

| Variable | Notes |
|----------|--------|
| `RCLONE_CONFIG_B2_TYPE` | `b2` |
| `RCLONE_CONFIG_B2_ACCOUNT` | secret (keyID) |
| `RCLONE_CONFIG_B2_KEY` | secret |
| `RCLONE_CONFIG_B2_HARD_DELETE` | `false` |

### Gestcopy non-secret routing

| Variable | Typical value |
|----------|----------------|
| `GESTCOPY_R2_BUCKET` | `gestcopy-files` |
| `GESTCOPY_B2_BUCKET` | `gestcopy-backups-prod-eu` |
| `GESTCOPY_B2_FILES_PREFIX` | `files` |

No `rclone.conf` with secrets is baked into the image. Remotes are configured entirely via `RCLONE_CONFIG_*` env vars.

## Scripts

| Script | Role |
|--------|------|
| `/app/scripts/backup-files.sh` | `rclone copy` R2 → B2/`files` |
| `/app/scripts/verify-files.sh` | `rclone check --one-way --download` (read-only) |
| `/app/scripts/backup-all.sh` | runs Files backup then verify; placeholder for B1.3 DB |

Success markers (stdout, only on success):

- `BACKUP_FILES_SUCCESS`
- `VERIFY_FILES_SUCCESS`
- `BACKUP_ALL_SUCCESS`

Any rclone / validation failure exits non-zero; `backup-all.sh` does not continue after a failed step.

## Local smoke (no secrets in repo)

Build:

```bash
docker build -t gestcopy-backup-runner:local ./infra/backup-runner
```

Syntax check (no credentials):

```bash
bash -n infra/backup-runner/scripts/*.sh
```

Static contract tests (no network / no credentials):

```bash
TZ=UTC npx tsx --test infra/backup-runner/backup-runner.test.ts
```

A full copy/verify requires injecting the env vars above into a running container. Do **not** commit secrets.

Optional: if `shellcheck` is installed locally, run:

```bash
shellcheck infra/backup-runner/scripts/*.sh
```

`shellcheck` is **not** added as a project dependency for this block.

## Coolify deployment (later — not this PR)

1. Create a dedicated Coolify resource from this Dockerfile (`infra/backup-runner`).
2. Configure the environment variables listed above (secrets in Coolify secret store).
3. Keep the container running (`CMD sleep infinity`); do **not** start backups from ENTRYPOINT.
4. Add a Scheduled Task:

| Field | Value |
|-------|--------|
| **Name** | Gestcopy Files Backup |
| **Frequency** | `17 * * * *` |
| **Command** | `/app/scripts/backup-all.sh` |
| **Timeout** | `3600` |

Hourly cadence is intentional. Minute `17` avoids pile-up on `:00`. Coolify uses the deployment server timezone; for an hourly schedule the minute offset is what matters, not the zone.

## PostgreSQL client (B1.3)

The image includes **PostgreSQL 17 client** tools for the upcoming database dump step. This PR only scaffolds/docs that path; no live `pg_dump` job is wired yet.

## Explicit non-goals

- No per-tenant buckets, DBs, or runners
- No writes to R2
- No deletes on B2
- No Object Lock changes
- No Supabase / Vercel / Files V1 / Cloudflare API / Backblaze API automation in this PR
- No production deploy and no merge from this documentation alone
