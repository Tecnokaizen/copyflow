# Gestcopy backup runner (B1.2 Files + B1.3 Database)

Versioned image + scripts for a **dedicated Coolify resource** that:

1. **B1.2 — Files:** copies Gestcopy Files from Cloudflare R2 → Backblaze B2 (`files/`)
2. **B1.3 — Database:** takes encrypted logical PostgreSQL/Supabase dumps → the same B2 bucket (`database/`)

This directory is infrastructure only. It does **not** change Gestcopy app code, Supabase schema/RLS/RPC/migrations, Files V1 runtime, Vercel, or cloud APIs.

## Architecture (immutable)

Gestcopy remains:

- one application core
- one shared Supabase/PostgreSQL
- multi-tenant via `tenant_id` + memberships + RLS
- one operative R2 bucket for Files
- one off-provider B2 destination for backups

Backups are **platform-global**. Do **not** create per-tenant databases, per-tenant dump jobs, or extra runners per tenant.

```
Cloudflare R2 (gestcopy-files)          Supabase / PostgreSQL (shared)
        │                                          │
        │  rclone copy                              │  pg_dump → age
        ▼                                          ▼
Backblaze B2 (gestcopy-backups-prod-eu)
        ├── files/orders/{tenant_id}/{order_id}/{file_id}
        └── database/YYYY/MM/DD/{TIMESTAMP}/
              ├── gestcopy-application.dump.age
              ├── gestcopy-auth.dump.age
              ├── gestcopy-migrations.dump.age
              └── manifest.json
```

- **B2 is off-site and independent** of Cloudflare and Supabase.
- B2 Object Lock: **Compliance, 30 days** (bucket default). B1.3 must **not** change Object Lock.
- Weekly/monthly retention tiers are out of scope (later retention policy block).
- Supabase **provider-native** backups are an additional safety layer, **not** a substitute for this off-provider copy.
- Storage objects live outside the database and are already covered by B1.2.

### Why `copy`, never `sync`

`rclone sync` can delete destination objects that are missing on the source. That is incompatible with Object Lock / retention and with a durable backup.

**Do not use `rclone sync`.** Do not pass `--delete-*` flags.

## Required environment variables

Set these in Coolify (or local shell). **Values are not documented here.**

### Rclone remote `R2` (Cloudflare) — Files only

| Variable | Notes |
|----------|--------|
| `RCLONE_CONFIG_R2_TYPE` | `s3` |
| `RCLONE_CONFIG_R2_PROVIDER` | `Cloudflare` |
| `RCLONE_CONFIG_R2_ACCESS_KEY_ID` | secret |
| `RCLONE_CONFIG_R2_SECRET_ACCESS_KEY` | secret |
| `RCLONE_CONFIG_R2_ENDPOINT` | R2 S3 API endpoint |
| `RCLONE_CONFIG_R2_REGION` | optional; exported default `auto` when unset or empty |
| `RCLONE_CONFIG_R2_NO_CHECK_BUCKET` | optional; exported default `true` when unset or empty |

### Rclone remote `B2` (Backblaze) — Files + Database

| Variable | Notes |
|----------|--------|
| `RCLONE_CONFIG_B2_TYPE` | `b2` |
| `RCLONE_CONFIG_B2_ACCOUNT` | secret (keyID) |
| `RCLONE_CONFIG_B2_KEY` | secret |
| `RCLONE_CONFIG_B2_HARD_DELETE` | optional; exported default `false`; keep `false` in production |

### Gestcopy routing (non-secret)

| Variable | Typical value |
|----------|----------------|
| `GESTCOPY_R2_BUCKET` | `gestcopy-files` |
| `GESTCOPY_B2_BUCKET` | `gestcopy-backups-prod-eu` |
| `GESTCOPY_B2_FILES_PREFIX` | `files` |
| `GESTCOPY_B2_DATABASE_PREFIX` | `database` (default if unset) |

### Database backup secrets (B1.3)

| Variable | Notes |
|----------|--------|
| `GESTCOPY_DATABASE_URL` | Direct or Session Pooler URI. Never hardcode. Never log. |
| `GESTCOPY_BACKUP_AGE_RECIPIENT` | Public age recipient only (`age1...`). **No private key in Coolify.** |

Defaults exported by `backup-database.sh`:

- `PGSSLMODE=require`
- `PGAPPNAME=gestcopy-backup-runner`
- `PGCONNECT_TIMEOUT=15`
- `GESTCOPY_SNAPSHOT_ACQUIRE_TIMEOUT_SECONDS=30`

No `rclone.conf` with secrets is baked into the image. Remotes are configured entirely via `RCLONE_CONFIG_*` env vars.

## Age encryption and private key (recovery)

Generate a key pair **offline** (not in this repo, not on Production):

```bash
age-keygen -o gestcopy-backup-age.key
# prints: Public key: age1...
```

- Production runner receives **only** `GESTCOPY_BACKUP_AGE_RECIPIENT=age1...`
- The **private** identity must never be stored in Coolify, GitHub, Vercel, Supabase, or beside the dumps in B2
- Keep the private key offline / in a password manager suitable for disaster recovery
- Without that private key, B2 `*.dump.age` objects cannot be recovered

Each dump is encrypted **before** leaving the container. Plaintext `*.dump` files live only in a `mktemp` directory and are deleted after successful `age` encryption (EXIT trap cleans the workdir).

## Database dump strategy (B1.3)

Do **not** ship one raw whole-database dump as the sole artifact. Produce three custom-format dumps that form **one coherent recovery set**:

| Artifact | Scope | Flags (base) |
|----------|--------|--------------|
| `gestcopy-application.dump.age` | schema `public` (tables, data, indexes, constraints, functions, triggers, views, RLS, sequences, **ACL/GRANT/REVOKE**) | `--format=custom --no-owner --no-subscriptions --schema=public` (**no** `--no-privileges`) |
| `gestcopy-auth.dump.age` | schema `auth` **data only**, except `auth.schema_migrations` | `--format=custom --data-only --no-owner --no-privileges --schema=auth --exclude-table-data=auth.schema_migrations` |
| `gestcopy-migrations.dump.age` | complete `supabase_migrations` schema **and data** | `--format=custom --no-owner --no-privileges --schema=supabase_migrations` |

### Shared exported snapshot

All three `pg_dump` invocations share the **same** PostgreSQL exported snapshot:

1. Open a long-lived `psql` session
2. `BEGIN ISOLATION LEVEL REPEATABLE READ, READ ONLY;`
3. `SELECT pg_export_snapshot();`
4. Pass identical `--snapshot="${SNAPSHOT_ID}"` to every dump
5. `COMMIT` / close the exporter only after the three dumps finish

The three dumps therefore form a **logical recovery set consistent at one snapshot**. The local EXIT trap always terminates the exporter so no orphan `psql` remains. The snapshot id is **not** written into `manifest.json` (not required for recovery).

Snapshot acquisition uses a real elapsed-time deadline, not a fixed retry count. A dead exporter fails immediately; a slow but healthy TLS connection may take up to `GESTCOPY_SNAPSHOT_ACQUIRE_TIMEOUT_SECONDS` (default `30`) to return the snapshot. No `pg_dump` starts without a valid snapshot.

After all three custom archives are created, and **before** age encryption or any upload, each archive must pass `pg_restore --list`. An unreadable application, auth, or migrations archive aborts the run, leaves no manifest, uploads nothing, and is removed in plaintext by the EXIT trap.

Manifest fields include:

- `consistency: "postgresql-exported-snapshot"`
- `status: "complete"`
- non-secret `external_recovery_requirements` identifiers for Vault, Auth configuration, and extensions

**Auth caveats (documented, not automated away):**

- `auth.schema_migrations` is deliberately excluded: the target's own Supabase Auth version keeps its migration history. The restore helper independently filters this table from an old archive as defence in depth.
- Auth user-data compatibility still depends on the Auth schema version of the restore target
- Do **not** restore Auth onto Production directly
- Test first on an isolated project/environment
- JWT secrets, API keys, and Auth dashboard configuration are **not** part of this artifact

**ACL note:** The application dump deliberately preserves PostgreSQL object privileges. RLS policies do **not** replace GRANT/REVOKE. An isolated restore target should be a Supabase-compatible environment with its standard roles; this helper does not recreate reserved Supabase roles.

### Upload: dumps first, manifest last (completion marker)

Upload is additive only (`rclone copyto`). Never `sync`. Never `--delete-*`.

1. **Phase A** — upload the three `*.dump.age` objects
2. **Phase B** — verify remote existence + exact byte sizes for those three
3. **Phase C** — only then upload `manifest.json`, verify its size, then print `DATABASE_BACKUP_SUCCESS`

The remote presence of:

`database/YYYY/MM/DD/TIMESTAMP/manifest.json`

means the recovery set finished upload and size validation. A prefix **without** `manifest.json` is an **INCOMPLETE BACKUP SET** and must not be selected automatically for recovery. Incomplete prefixes are **not** deleted here (Object Lock may prevent it; retention cleanup is a later block).

Deep hash verification without re-download remains deferred to recovery drills.

## Scripts

| Script | Role |
|--------|------|
| `/app/scripts/backup-files.sh` | `rclone copy` R2 → B2/`files` |
| `/app/scripts/verify-files.sh` | `rclone check --one-way --download` (read-only) |
| `/app/scripts/backup-all.sh` | Files copy **only** (hourly). Does **not** run DB backup. |
| `/app/scripts/backup-database.sh` | pg_dump ×3 → age → B2/`database/...` |
| `/app/scripts/restore-database-local.sh` | Isolated restore helper (manual; never scheduled) |
| `/app/scripts/runner-lock.sh` | shared flock helper |

Success markers (stdout, only on success):

- `BACKUP_FILES_SUCCESS`
- `VERIFY_FILES_SUCCESS`
- `BACKUP_ALL_SUCCESS`
- `DATABASE_BACKUP_SUCCESS`
- `RESTORE_DATABASE_ISOLATED_SUCCESS`

Any failure exits non-zero and must **not** print a success marker.

### Shared lock

Copy, verification, and database backup share an exclusive, non-blocking `flock`. A conflicting job exits **75**, logs `BACKUP_RUNNER_BUSY`, and never starts rclone/`pg_dump` or prints success. Treat **exit 75 as a missed run requiring retry**, not success.

Default lock file: `/tmp/gestcopy-backup-runner.lock`. Override with `GESTCOPY_BACKUP_LOCK_FILE` for tests (all jobs must share the same path).

Run exactly **one** runner container.

## Isolated restore helper

`restore-database-local.sh` is a **manual** recovery-drill helper for **isolated** Supabase Direct / Session Pooler targets. It must **never** be a Coolify Scheduled Task.

Requires:

| Variable | Role |
|----------|------|
| `GESTCOPY_ALLOW_RESTORE=isolated-only` | explicit confirmation |
| `GESTCOPY_ALLOW_PUBLIC_RESET=isolated-only` | explicit confirmation that `public` will be destroyed/reset |
| `GESTCOPY_RESTORE_TARGET_URL` | isolated target URI (never Production) |
| `GESTCOPY_PRODUCTION_PROJECT_REF` | non-secret Production project ref |
| `GESTCOPY_RESTORE_TARGET_PROJECT_REF` | non-secret isolated target project ref |

Rejects **before** target mutation when:

1. target project ref equals production project ref
2. target URL contains the production project ref (case-insensitive)
3. `GESTCOPY_DATABASE_URL` is present and equals the target URL

Errors mention Production project-ref resolution; they never print full connection strings or credentials. Project-ref guards remain effective even if `GESTCOPY_DATABASE_URL` is absent.

The helper requires already-decrypted `--application PATH`, `--auth PATH`, and (for a full drill) `--migrations PATH`. Before connecting destructively to the target, it verifies every selected artifact exists, is non-empty, and is a readable custom archive using `pg_restore --list`. The application archive must contain the `public` schema definition; the migrations archive must contain both the `supabase_migrations` schema and its `schema_migrations` table data. Any failure exits before target `psql`, before `DROP`, and before restore.

The target must be a **disposable, isolated, Supabase-compatible project**. Vanilla PostgreSQL is not a supported full-recovery target because `public.profiles(id)` references `auth.users(id)` and recovery depends on compatible Supabase Auth objects and users.

After every guard and archive preflight passes, the helper runs:

```sql
DROP SCHEMA IF EXISTS public CASCADE;
```

It does **not** recreate `public` manually: application pre-data recreates it from the archive. The helper therefore destroys/resets `public` only on the explicitly confirmed isolated target. Never use it on a persistent or Production project.

### Restore order (sectioned)

Schema inspection shows `public.profiles(id)` has `FOREIGN KEY … REFERENCES auth.users(id)`. Membership and invitation RPCs also join `auth.users`. Therefore restore applies application constraints **after** auth data:

1. reset `public` on the confirmed isolated target
2. application `--section=pre-data` (`--no-owner`, **no** `--no-privileges`), which recreates `public`
3. application `--section=data`
4. mandatory auth data (`--data-only --no-owner --no-privileges`), using an explicit filtered restore list which always excludes `auth.schema_migrations` (including for a legacy archive)
5. `supabase_migrations` schema + data unless `--skip-migrations`, so a newly created Supabase project without that schema can recover the migration history
6. application `--section=post-data` (FKs / indexes / triggers / ACL)

Auth is mandatory for full recovery. `--skip-migrations` remains available only for a data recovery that intentionally omits Supabase CLI migration history; that mode is **not** a full recovery drill. Full recovery onto a new Supabase project still requires validating Auth schema compatibility before applying the auth dump.

## EXTERNAL RECOVERY REQUIREMENTS

The logical dumps do **not** contain the Supabase Vault root encryption key. Gestcopy's `files_signing_secret` must remain external to B2, the manifest, Git, Coolify database-backup environment variables, and logs. This PR deliberately does not automate secret injection.

After restoring a new isolated Supabase instance:

1. Reconfigure Supabase Auth/API settings that live outside the logical dump.
2. Verify the required Supabase/PostgreSQL extensions.
3. Reinject `files_signing_secret` into Supabase Vault from the approved external secure source.
4. Verify it matches the secret expected by the Gestcopy application/configuration.
5. Exercise Files signed-upload/download flows before declaring recovery complete.

`manifest.json` contains only these non-secret requirement identifiers:

- `supabase-vault:files_signing_secret`
- `supabase-auth-config`
- `supabase-extensions`

It never contains their values.

## Local smoke (no secrets in repo)

Build:

```bash
docker build -t gestcopy-backup-runner:db-v1 ./infra/backup-runner
```

Syntax check (no credentials):

```bash
for script in infra/backup-runner/scripts/*.sh; do bash -n "$script" || exit 1; done
```

Static contract tests:

```bash
TZ=UTC npx tsx --test infra/backup-runner/backup-runner.test.ts
```

Behavioral regression (image `flock` + `age`, fake `rclone`/`psql`/`pg_dump`, no network):

```bash
docker run --rm --network none \
  -v "$PWD/infra/backup-runner:/tests:ro" \
  gestcopy-backup-runner:db-v1 \
  bash /tests/backup-runner.runtime.test.sh
```

Do **not** commit secrets. Do **not** run live dumps against Production Supabase from this documentation alone.

Optional: `shellcheck infra/backup-runner/scripts/*.sh` if installed locally (not a project dependency).

## Coolify deployment (later — not this PR)

| Coolify field | Value |
|---------------|--------|
| **Base Directory** | `/infra/backup-runner` |
| **Dockerfile Location** | `Dockerfile` |

Keep the container running (`CMD sleep infinity`); do **not** start backups from ENTRYPOINT.

### Scheduled Tasks (same container)

| Field | Files hourly copy | Files weekly verify | Database backup |
|-------|-------------------|---------------------|-----------------|
| **Name** | Gestcopy Files Backup | Gestcopy Files Full Verification | Gestcopy Database Backup |
| **Frequency** | `17 * * * *` | `35 2 * * 0` | `27 */6 * * *` |
| **Command** | `/app/scripts/backup-all.sh` | `/app/scripts/verify-files.sh` | `/app/scripts/backup-database.sh` |
| **Timeout** | `3300` | `21600` | `3600` |

Database cadence every **6 hours** targets an application RPO ≤ 6 h for Gestcopy’s own off-provider dumps. That is an **operational objective**, not a guarantee from Supabase.

If the database job collides with Files verify (shared flock), expect **exit 75** → missed run → retry. That is not success.

## Validation and release status

Passing local tests makes this change reviewable, not operationally validated. Before enabling schedules in Production:

1. Confirm Files copy + weekly verify with authorized Coolify credentials
2. Confirm a database backup run with authorized DB URL + age recipient
3. Perform an **isolated** restore drill (never against Production)

No live Production dump, restore, Coolify deploy, or merge is performed by these tests alone.

## Explicit non-goals

- No per-tenant buckets, DBs, or runners
- No writes to R2
- No deletes on B2
- No Object Lock changes
- No weekly 12-week / monthly 12-month retention automation (later)
- No private age key in Coolify / git / cloud dashboards
- No scheduled restores
- No Supabase / Vercel / Files V1 / Cloudflare API / Backblaze API automation in this PR
- No Production deploy and no merge from this documentation alone
