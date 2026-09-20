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
| `RCLONE_CONFIG_R2_REGION` | optional; exported default `auto` when unset or empty |
| `RCLONE_CONFIG_R2_NO_CHECK_BUCKET` | optional; exported default `true` when unset or empty |

### Rclone remote `B2` (Backblaze)

| Variable | Notes |
|----------|--------|
| `RCLONE_CONFIG_B2_TYPE` | `b2` |
| `RCLONE_CONFIG_B2_ACCOUNT` | secret (keyID) |
| `RCLONE_CONFIG_B2_KEY` | secret |
| `RCLONE_CONFIG_B2_HARD_DELETE` | optional; exported default `false` when unset or empty; keep `false` in production |

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
| `/app/scripts/backup-all.sh` | runs Files copy only; placeholder for B1.3 DB |
| `/app/scripts/runner-lock.sh` | shared lock helper, sourced by copy and verification |

Success markers (stdout, only on success):

- `BACKUP_FILES_SUCCESS`
- `VERIFY_FILES_SUCCESS`
- `BACKUP_ALL_SUCCESS`

Any rclone / validation failure exits non-zero; `backup-all.sh` does not continue after a failed step.

Copy and full verification share an exclusive, non-blocking `flock`. This also protects direct manual invocations of `backup-files.sh` and copies invoked through `backup-all.sh`. A conflicting job exits **75**, logs `BACKUP_RUNNER_BUSY`, and never calls rclone or prints a success marker. Treat this as a missed run requiring a retry, not a successful backup.

The default lock file is `/tmp/gestcopy-backup-runner.lock`. For local tests, `GESTCOPY_BACKUP_LOCK_FILE` can select another writable path; all invocations must use the same path. The kernel releases the lock when the last process holding its descriptor exits, including failed or interrupted transfers. Do not delete the lock file to unlock it: that can allow parallel jobs to lock different inodes.

Run exactly **one runner container**. This is container-local exclusion, not a distributed lock; a second replica or overlapping deployments would require coordination. Keep both tasks on the same container and avoid redeploying during a job. When B1.3 adds another phase, extend the orchestration lock across the entire sequence before enabling it.

## Local smoke (no secrets in repo)

Build:

```bash
docker build -t gestcopy-backup-runner:local ./infra/backup-runner
```

Syntax check (no credentials):

```bash
for script in infra/backup-runner/scripts/*.sh; do bash -n "$script" || exit 1; done
```

Static contract tests (no network / no credentials):

```bash
TZ=UTC npx tsx --test infra/backup-runner/backup-runner.test.ts
```

Behavioral regression tests use the image's real `flock` and a fake rclone process, with a clean environment and dummy credentials. They check exported defaults, overrides, failure propagation, copy/check exclusion, lock release and hourly copy-only orchestration. No cloud credentials or network are needed:

```bash
docker run --rm --network none \
  -v "$PWD/infra/backup-runner:/tests:ro" \
  gestcopy-backup-runner:local bash /tests/backup-runner.runtime.test.sh
```

On Linux with Bash and util-linux `flock`, the same suite can run directly with `bash infra/backup-runner/backup-runner.runtime.test.sh`.

A full copy/verify requires injecting the env vars above into a running container. Do **not** commit secrets.

Optional: if `shellcheck` is installed locally, run:

```bash
shellcheck infra/backup-runner/scripts/*.sh
```

`shellcheck` is **not** added as a project dependency for this block.

## Coolify deployment (later — not this PR)

Configure the Coolify build so the Docker context is **only** this runner directory (not the monorepo root). That is required for:

```dockerfile
COPY scripts/ /app/scripts/
```

to resolve `scripts/` relative to the runner folder.

| Coolify field | Value |
|---------------|--------|
| **Base Directory** | `/infra/backup-runner` |
| **Dockerfile Location** | `Dockerfile` |

1. Create a dedicated Coolify resource from this Dockerfile with the Base Directory / Dockerfile Location above.
2. Configure the environment variables listed above (secrets in Coolify secret store).
3. Keep the container running (`CMD sleep infinity`); do **not** start backups from ENTRYPOINT.
4. Add two Scheduled Tasks targeting the same runner container:

| Field | Hourly copy | Weekly full verification |
|-------|-------------|--------------------------|
| **Name** | Gestcopy Files Backup | Gestcopy Files Full Verification |
| **Frequency** | `17 * * * *` | `35 2 * * 0` |
| **Command** | `/app/scripts/backup-all.sh` | `/app/scripts/verify-files.sh` |
| **Timeout** | `3300` | `21600` (initial six-hour ceiling; measure before enabling) |

Hourly cadence is intentional. Minute `17` avoids pile-up on `:00`; the 55-minute copy timeout leaves a gap before the next run. Confirm the effective scheduler timezone in Coolify: the weekly expression means Sunday at 02:35 in that timezone. Schedule the first verification after a successful copy.

Full verification is deliberately separate: `rclone check --download` reads the entire corpus from **both** remotes. Its runtime, requests and transfer volume scale with total stored data. It is not an incremental check and must not be appended to the hourly task. See [rclone check](https://rclone.org/commands/rclone_check/) and [Coolify Scheduled Tasks](https://coolify.io/docs/core/automation/scheduled-tasks/overview).

The weekly job can occupy the lock across hourly slots. Those copies fail with exit 75 rather than overlap; after verification, run a catch-up copy or confirm the next hourly run succeeds. Monitor failure/busy logs and time since the last successful copy and verification separately. A timeout or conflict never counts as verification success. Measure corpus size, duration and transfer cost before enabling this schedule; if the resulting backup gap is unacceptable, use a dedicated maintenance window or design bounded incremental verification before production rollout. Increasing the timeout alone does not preserve an hourly recovery point.

In production, stop the complete timed-out process tree before retrying. A surviving transfer retains its inherited lock; do not force another job by deleting the lock file.

## Validation and release status

Report fresh counts after changes; the behavioral shell suite reports its own checks separately.

Local validation of the final polish (2026-09-20):

- TypeScript suite: **513 total, 513 passed, 0 skipped, 0 failed**; includes all 7 runner contract tests.
- Additional behavioral shell suite: **21 passed, 0 failed**, run as the image's non-root user with networking disabled and fake rclone.
- ESLint, TypeScript `--noEmit`, shell syntax and `git diff --check`: passed.
- Docker image build: passed on **Alpine 3.24** with rclone, util-linux `flock`, and PostgreSQL 17 client.

P3 follow-up: add a remote CI check for this directory that runs contract and behavioral tests, shell syntax, lint/types and the Docker build. Existing Vercel checks do not validate this runner; the existing Kiosk workflow is path-filtered and does not cover runner-only changes.

Passing local tests makes this change reviewable, not operationally validated. Before closing B1.2 deployment, confirm a real copy, full verification and an isolated recovery exercise with authorized credentials from Coolify. No live backup, restore, Coolify change or production deployment is performed by these tests.

## PostgreSQL client (B1.3)

The image includes **PostgreSQL 17 client** tools for the upcoming database dump step. This PR only scaffolds/docs that path; no live `pg_dump` job is wired yet.

## Explicit non-goals

- No per-tenant buckets, DBs, or runners
- No writes to R2
- No deletes on B2
- No Object Lock changes
- No Supabase / Vercel / Files V1 / Cloudflare API / Backblaze API automation in this PR
- No production deploy and no merge from this documentation alone
