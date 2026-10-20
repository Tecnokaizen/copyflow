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
              ├── gestcopy-application.dump.age   (public + private schemas)
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
| `gestcopy-application.dump.age` | **every application schema**: `public` and the Gestcopy private schemas (`files_private`, `imports_private`, `kiosk_private`, and later ones such as `billing_private`), with tables, data, indexes, constraints, functions, triggers, views, RLS, sequences and **ACL/GRANT/REVOKE** | `--format=custom --no-owner --no-subscriptions --strict-names --schema=<each application schema>` (**no** `--no-privileges`) |
| `gestcopy-auth.dump.age` | schema `auth` **data only**, except `auth.schema_migrations` | `--format=custom --data-only --no-owner --no-privileges --schema=auth --exclude-table-data=auth.schema_migrations` |
| `gestcopy-migrations.dump.age` | complete `supabase_migrations` schema **and data** | `--format=custom --no-owner --no-privileges --schema=supabase_migrations` |

### Application schemas (B1.3 fix, October 2026)

Until October 2026 the application dump selected `--schema=public` only. The
private schemas created by later migrations were therefore missing from every
recovery set, and the 19/10/2026 drill failed in application post-data:
`public.clients` has the trigger `clients_import_origin_guard`, which runs
`imports_private.guard_client_origin()`, and a foreign key to
`imports_private.client_import_batches`. Those sets (manifest `version: "1"`)
also lack all private-table data. The restore helper rejects them.

`scripts/recovery-contract.sh` (sourced by both scripts) now defines the set:

- **Discovery, never a fixed subset.** Inside the snapshot transaction, every
  schema except PostgreSQL's own (`pg_*`, `information_schema`) and the listed
  Supabase platform schemas (`auth`, `storage`, `extensions`, `realtime`,
  `_realtime`, `vault`, `supabase_migrations`, `supabase_functions`, …) is an
  application schema and is dumped. A schema added by a future migration is
  included without changing the runner.
- **Required baseline.** `public`, `files_private`, `imports_private` and
  `kiosk_private` exist in Production; a source without any of them fails before
  `pg_dump`.
- **Recovery fingerprint.** In the same snapshot, per application schema: exact
  row counts, RLS flags, policies, functions (and how many are SECURITY
  DEFINER), triggers, constraints (and FKs), indexes, views, types, sequences and
  the ACL entries of every role other than the owner, `postgres`,
  `supabase_admin` and `pg_database_owner` (those are reassigned by
  `--no-owner`). Definitions are compared as MD5 hashes of the fully qualified
  deparse; extension objects are excluded. Only aggregate counts and hashes are
  stored, no row data.
- **Archive check before encryption.** The application archive must define
  exactly the discovered schemas and the same number of tables per schema as the
  catalog. Otherwise the run fails before `age`, before any upload, and without
  a manifest.

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

- `version: "2"` (multi-schema recovery set)
- `consistency: "postgresql-exported-snapshot"`
- `status: "complete"`
- `application_schemas`: the schemas in the application archive
- `recovery_contract`: the recovery fingerprint (`fingerprint_version: 1`)
- non-secret `external_recovery_requirements` identifiers for Vault, Auth configuration, extensions, and Supabase Automatic RLS

**Auth caveats (documented, not automated away):**

- `auth.schema_migrations` is deliberately excluded: the target's own Supabase Auth version keeps its migration history. The restore helper independently filters this table from an old archive as defence in depth.
- Auth user-data compatibility still depends on the Auth schema version of the restore target
- Do **not** restore Auth onto Production directly
- Test first on an isolated project/environment
- JWT secrets, API keys, and Auth dashboard configuration are **not** part of this artifact

**ACL note:** The application dump deliberately preserves PostgreSQL object privileges. RLS policies do **not** replace GRANT/REVOKE. An isolated restore target should be a Supabase-compatible environment with its standard roles; this helper does not recreate reserved Supabase roles.

**Default ACL compatibility note:** the application archive can contain `DEFAULT ACL` entries owned by the internal Supabase role `supabase_admin`. A normal project `postgres` connection cannot change those defaults. The restore helper uses a `pg_restore --use-list` TOC generated from the application archive: it excludes **only** `DEFAULT ACL` entries whose owner is `supabase_admin`. It retains normal ACLs and every `DEFAULT ACL` owned by `postgres`; errors are not ignored and post-data still uses `--exit-on-error`.

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

The helper requires the set's `--manifest PATH` and the already-decrypted `--application PATH`, `--auth PATH`, and (for a full drill) `--migrations PATH`. Before connecting destructively to the target, it verifies:

- the manifest is complete, `version: "2"`, and declares the required application schemas with a recovery fingerprint for each of them; a `version: "1"` (public-only) set is rejected;
- every artifact exists, is non-empty, and is a readable custom archive (`pg_restore --list`);
- the application archive defines exactly the declared schemas (including `public`), with the declared number of tables in each;
- the migrations archive contains both the `supabase_migrations` schema and its `schema_migrations` table data.

Any failure exits before target `psql`, before `DROP`, and before restore.

Before `DROP public`, the helper makes **read-only** target checks: the B1.3 recovery contract `pg_trgm@extensions` (the canonical application archive references `extensions.gin_trgm_ops`), and the PostgreSQL major version, which must equal the source's (the fingerprint compares deparsed definitions). If either fails, the helper stops before any mutation; it never runs `CREATE EXTENSION` automatically.

The target must be a **disposable, isolated, Supabase-compatible project**. Vanilla PostgreSQL is not a supported full-recovery target because `public.profiles(id)` references `auth.users(id)` and recovery depends on compatible Supabase Auth objects and users.

After every guard, archive preflight, and read-only target check passes, the helper resets every application schema in one transaction:

```sql
DROP SCHEMA IF EXISTS public CASCADE;
DROP SCHEMA IF EXISTS files_private CASCADE;   -- every other declared schema
CREATE SCHEMA public;
GRANT USAGE ON SCHEMA public TO PUBLIC;
```

`public` is recreated with the privilege PostgreSQL 15+ records as its initial privilege (`pg_init_privs`). `pg_dump` never emits that grant and dumps the ACL of `public` relative to it, so a schema recreated from the archive alone would lose it. Pre-data restores everything else (including the archive's own `public` grants and any REVOKE). `GESTCOPY_ALLOW_PUBLIC_RESET=isolated-only` confirms this reset of `public` and the private schemas; it happens only on the explicitly confirmed isolated target. Never use it on a persistent or Production project.

### Restore order (sectioned)

Schema inspection shows `public.profiles(id)` has `FOREIGN KEY … REFERENCES auth.users(id)`. Membership and invitation RPCs also join `auth.users`. Therefore restore applies application constraints **after** auth data:

1. reset every application schema on the confirmed isolated target and recreate `public` with its initial privilege
2. application `--section=pre-data` (`--no-owner`, **no** `--no-privileges`), which recreates the private schemas and every object, in dependency order across schemas
3. application `--section=data`
4. mandatory auth data (`--data-only --no-owner --no-privileges`), using an explicit filtered restore list which always excludes `auth.schema_migrations` (including for a legacy archive)
5. `supabase_migrations` schema + data unless `--skip-migrations`, so a newly created Supabase project without that schema can recover the migration history
6. application `--section=post-data` (FKs / indexes / triggers / ACL) through a filtered TOC that excludes only `supabase_admin` `DEFAULT ACL` entries
7. read-only semantic validation: `public` exists, has tables, every public table has RLS, public policies exist, and `supabase_migrations.schema_migrations` exists unless `--skip-migrations` was requested
8. recovery fingerprint: recomputed on the target for every declared schema and compared with the manifest; any difference is listed (schema, metric, expected, restored)

The success marker is printed only after both validations succeed. Auth is mandatory for full recovery. `--skip-migrations` remains available only for a data recovery that intentionally omits Supabase CLI migration history; that mode is **not** a full recovery drill. Full recovery onto a new Supabase project still requires validating Auth schema compatibility before applying the auth dump.

## EXTERNAL RECOVERY REQUIREMENTS

The logical dumps do **not** contain the Supabase Vault root encryption key. Gestcopy's `files_signing_secret` and `kiosk_signing_secret` must remain external to B2, the manifest, Git, Coolify database-backup environment variables, and logs. This PR deliberately does not automate secret injection.

After restoring a new isolated Supabase instance:

1. Reconfigure Supabase Auth/API settings that live outside the logical dump.
2. Verify the required Supabase/PostgreSQL extensions. For B1.3, `pg_trgm` must be installed in `extensions` before invoking the helper.
3. Reinject `files_signing_secret` and `kiosk_signing_secret` into Supabase Vault from the approved external secure source.
4. Verify they match the secrets expected by the Gestcopy application/configuration.
5. Re-enable and separately verify Supabase Automatic RLS as described below.
6. Exercise Files signed-upload/download and kiosk flows before declaring recovery complete.

### Supabase Automatic RLS is external to the logical recovery set

`DROP SCHEMA public CASCADE` also removes `public.rls_auto_enable()` and the global `ensure_rls` Event Trigger that depends on it. The application archive can recreate the `public` function, but it does not recreate that global event trigger. Therefore `supabase-automatic-rls` is an explicit post-restore requirement, not an object that this helper recreates blindly.

After the helper reports success, verify it independently as the project `postgres` user:

```sql
SELECT evtname, evtenabled, evtfoid::regprocedure
FROM pg_event_trigger
WHERE evtname = 'ensure_rls';
```

The expected enabled trigger is `ensure_rls` running the intended RLS auto-enable function. If it is missing or disabled, reactivate it using Supabase's supported [Event Triggers guide](https://supabase.com/docs/guides/database/postgres/event-triggers), which documents the `rls_auto_enable()` / `ensure_rls` pattern. Do this as an explicit post-restore operation after reviewing the target; do not copy internal Supabase objects or rely on an undocumented helper implementation.

### Recovery-drill validation baseline

Since manifest version 2 the baseline travels with each recovery set: the helper compares the restored target with the set's own `recovery_contract` (exact rows, RLS, policies, ACL, SECURITY DEFINER functions, triggers, FKs and indexes per application schema) and refuses success on any difference. No schema version is hardcoded. Historic reference: the B1.3.1 set `database/2026/09/20/20260920T185408Z` had **27 public tables with RLS enabled (27/27)** and **60 public policies**, before the private schemas existed. Also run the following after a clean isolated restore and before declaring the drill complete:

```sql
SELECT
  count(*) AS public_tables,
  count(*) FILTER (WHERE c.relrowsecurity) AS rls_enabled
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind IN ('r', 'p');

SELECT count(*) AS policies
FROM pg_policies
WHERE schemaname = 'public';

SELECT to_regclass('supabase_migrations.schema_migrations') IS NOT NULL
  AS migrations_history_exists;
```

Investigate any fingerprint mismatch rather than changing the helper's checks. Also verify Automatic RLS separately with the query above: existing restored tables retain their RLS state, while Automatic RLS governs future table creation.

`manifest.json` contains only these non-secret requirement identifiers:

- `supabase-vault:files_signing_secret`
- `supabase-vault:kiosk_signing_secret`
- `supabase-auth-config`
- `supabase-extensions`
- `supabase-automatic-rls`

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

End-to-end recovery drill with real PostgreSQL tools (Docker + Supabase CLI; two disposable local stacks, a throwaway age key and an rclone local remote; no secrets). It backs up a migrated and seeded source with the real image, proves that sets missing a private schema are rejected before the target changes, restores into an empty Supabase project and compares the fingerprints of source and target independently:

```bash
bash infra/backup-runner/backup-runner.recovery.test.sh
```

The Release Gate runs it on every pull request (job `Backup recovery (B1.3)`).

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
