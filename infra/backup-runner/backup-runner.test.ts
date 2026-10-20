import assert from "node:assert/strict";
import { accessSync, constants, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";

const root = path.join(import.meta.dirname, "../..");
const runnerDir = path.join(root, "infra/backup-runner");
const scriptsDir = path.join(runnerDir, "scripts");

function read(rel: string): string {
  return readFileSync(path.join(runnerDir, rel), "utf8");
}

function stripComments(source: string): string {
  return source.replace(/^\s*#.*$/gm, "");
}

describe("infra/backup-runner static contract", () => {
  const dockerfile = read("Dockerfile");
  const backupFiles = read("scripts/backup-files.sh");
  const verifyFiles = read("scripts/verify-files.sh");
  const backupAll = read("scripts/backup-all.sh");
  const backupDatabase = read("scripts/backup-database.sh");
  const restoreDatabase = read("scripts/restore-database-local.sh");
  const recoveryContract = read("scripts/recovery-contract.sh");
  const runnerLock = read("scripts/runner-lock.sh");
  const readme = read("README.md");

  it("Dockerfile installs rclone, bash tooling, postgres 17 client, and age", () => {
    assert.match(dockerfile, /FROM alpine:3\.24/);
    assert.match(dockerfile, /\brclone\b/);
    assert.match(dockerfile, /\bbash\b/);
    assert.match(dockerfile, /\bjq\b/);
    assert.match(dockerfile, /\bcurl\b/);
    assert.match(dockerfile, /\bflock\b/);
    assert.match(dockerfile, /\bage\b/);
    assert.match(dockerfile, /ca-certificates/);
    assert.match(dockerfile, /postgresql17-client/);
    assert.match(dockerfile, /sleep", "infinity/);
    assert.match(dockerfile, /USER backup/);
    assert.equal(/^\s*ENTRYPOINT\b/im.test(dockerfile), false);
  });

  it("backup-files uses rclone copy and never sync/delete", () => {
    const executable = stripComments(backupFiles).replace(
      /\$\{[^}]*HARD_DELETE[^}]*\}/g,
      ""
    );
    assert.match(backupFiles, /\brclone copy\b/);
    assert.equal(/\brclone\s+sync\b/.test(executable), false);
    assert.equal(/--delete(?:-|$)/.test(executable), false);
    assert.match(backupFiles, /BACKUP_FILES_SUCCESS/);
    assert.match(backupFiles, /set -Eeuo pipefail/);
  });

  it("verify-files uses rclone check one-way download", () => {
    assert.match(verifyFiles, /\brclone check\b/);
    assert.match(verifyFiles, /--one-way/);
    assert.match(verifyFiles, /--download/);
    assert.equal(/\brclone\s+sync\b/.test(verifyFiles), false);
    assert.equal(/--delete(?:-|$)/.test(verifyFiles), false);
    assert.match(verifyFiles, /VERIFY_FILES_SUCCESS/);
  });

  it("backup-all runs Files copy only and does not schedule database", () => {
    assert.match(backupAll, /backup-files\.sh/);
    assert.doesNotMatch(backupAll, /verify-files\.sh/);
    assert.doesNotMatch(stripComments(backupAll), /backup-database\.sh/);
    assert.match(backupAll, /BACKUP_ALL_SUCCESS/);
    assert.match(backupAll, /B1\.3/);
  });

  it("backup-database dumps application schemas/auth/migrations, encrypts with age, and uploads safely", () => {
    const executable = stripComments(backupDatabase).replace(
      /\$\{[^}]*HARD_DELETE[^}]*\}/g,
      ""
    );
    assert.match(backupDatabase, /set -Eeuo pipefail/);
    assert.match(backupDatabase, /\bpg_dump\b/);
    assert.match(backupDatabase, /recovery-contract\.sh/);
    assert.match(backupDatabase, /application_schemas_sql/);
    assert.match(backupDatabase, /recovery_fingerprint_sql/);
    assert.match(backupDatabase, /APPLICATION_SCHEMA_ARGS\+=\("--schema=\$\{schema\}"\)/);
    assert.match(backupDatabase, /--strict-names/);
    assert.match(backupDatabase, /required application schema missing in source/);
    assert.match(backupDatabase, /application archive omits schema/);
    assert.match(backupDatabase, /--arg version "2"/);
    assert.match(backupDatabase, /recovery_contract: \$recovery_contract/);
    assert.match(backupDatabase, /supabase-vault:kiosk_signing_secret/);
    assert.match(backupDatabase, /--schema=auth/);
    assert.match(backupDatabase, /--data-only/);
    assert.match(backupDatabase, /--exclude-table-data=auth\.schema_migrations/);
    assert.match(backupDatabase, /--schema=supabase_migrations/);
    assert.doesNotMatch(
      backupDatabase.match(/dumping full supabase_migrations[\s\S]*?(?=ensure_exporter_alive\n?echo "backup-database: closing)/)?.[0] ?? "",
      /--data-only/
    );
    assert.match(backupDatabase, /\bage\b/);
    assert.match(backupDatabase, /GESTCOPY_BACKUP_AGE_RECIPIENT/);
    assert.match(backupDatabase, /runner-lock\.sh/);
    assert.match(backupDatabase, /acquire_runner_lock/);
    assert.match(backupDatabase, /DATABASE_BACKUP_SUCCESS/);
    assert.match(backupDatabase, /\btrap\b/);
    assert.match(backupDatabase, /mktemp/);
    assert.match(backupDatabase, /\brclone copyto\b/);
    assert.match(backupDatabase, /pg_export_snapshot/);
    assert.match(backupDatabase, /--snapshot=/);
    assert.match(backupDatabase, /postgresql-exported-snapshot/);
    assert.match(backupDatabase, /status: "complete"/);
    assert.equal(/\brclone\s+sync\b/.test(executable), false);
    assert.equal(/--delete(?:-|$)/.test(executable), false);
    assert.equal(/AGE-SECRET-KEY/i.test(backupDatabase), false);
    assert.equal(/age-keygen/.test(executable), false);
    assert.equal(/\becho\b.*GESTCOPY_DATABASE_URL/.test(executable), false);
    assert.equal(/printf\b.*GESTCOPY_DATABASE_URL/.test(executable), false);
    assert.match(backupDatabase, /PGSSLMODE/);
    assert.match(backupDatabase, /PGAPPNAME/);
    assert.match(backupDatabase, /select version\(\)/);
    assert.match(backupDatabase, /SHOW server_version/);
    assert.match(backupDatabase, /manifest\.json/);
    assert.match(backupDatabase, /encryption.*age|encryption: "age"/);
    assert.match(backupDatabase, /pg_restore --list/);
    assert.match(backupDatabase, /GESTCOPY_SNAPSHOT_ACQUIRE_TIMEOUT_SECONDS/);
    assert.match(backupDatabase, /PGCONNECT_TIMEOUT/);
    assert.match(backupDatabase, /supabase-vault:files_signing_secret/);
    assert.match(backupDatabase, /supabase-automatic-rls/);
    assert.match(backupDatabase, /auth_schema_migrations: "excluded"/);
    assert.match(backupDatabase, /supabase_migrations: "schema-and-data"/);

    const appDump = stripComments(
      backupDatabase.match(/dumping application[\s\S]*?(?=dumping auth)/)?.[0] ?? ""
    );
    assert.ok(appDump, "application dump section missing");
    assert.doesNotMatch(appDump, /--no-privileges/);
    assert.match(appDump, /--snapshot=/);
    assert.match(appDump, /"\$\{APPLICATION_SCHEMA_ARGS\[@\]\}"/);
    // Never a hardcoded public-only application dump again (B1.3 defect).
    assert.doesNotMatch(appDump, /--schema=public/);
  });

  it("recovery contract covers every schema the migrations create", () => {
    const migrationsDir = path.join(root, "supabase/migrations");
    const created = new Set<string>();
    for (const name of readdirSync(migrationsDir).filter((file) => file.endsWith(".sql"))) {
      const sql = readFileSync(path.join(migrationsDir, name), "utf8");
      for (const match of sql.matchAll(/create\s+schema\s+(?:if\s+not\s+exists\s+)?"?([a-z_][a-z0-9_]*)"?/gi)) {
        created.add(match[1].toLowerCase());
      }
    }
    const list = (name: string) =>
      (recoveryContract.match(new RegExp(`${name}=\\(([^)]*)\\)`))?.[1] ?? "")
        .split(/\s+/)
        .filter(Boolean);
    const platform = new Set(list("GESTCOPY_PLATFORM_SCHEMAS"));
    const required = list("GESTCOPY_REQUIRED_APPLICATION_SCHEMAS");

    assert.ok(platform.has("auth") && platform.has("storage") && platform.has("_realtime"));
    assert.ok(created.has("files_private") && created.has("imports_private") && created.has("kiosk_private"));
    for (const schema of created) {
      if (schema === "extensions") continue; // Supabase-managed; migrations only ensure it exists.
      assert.equal(platform.has(schema), false, `${schema} is created by a migration but treated as platform`);
    }
    assert.deepEqual(required, ["public", "files_private", "imports_private", "kiosk_private"]);
    for (const schema of required) {
      assert.ok(schema === "public" || created.has(schema), `${schema} is required but no migration creates it`);
    }
    assert.match(recoveryContract, /pg_get_functiondef/);
    assert.match(recoveryContract, /prosecdef/);
    assert.match(recoveryContract, /aclexplode/);
    assert.match(recoveryContract, /pg_get_triggerdef/);
    assert.match(recoveryContract, /pg_get_constraintdef/);
    assert.match(recoveryContract, /pg_get_indexdef/);
    assert.match(recoveryContract, /relrowsecurity/);
    assert.match(recoveryContract, /query_to_xml/);
  });

  it("restore helper guards against production restores and uses section order", () => {
    assert.match(restoreDatabase, /GESTCOPY_RESTORE_TARGET_URL/);
    assert.match(restoreDatabase, /GESTCOPY_ALLOW_RESTORE=isolated-only/);
    assert.match(restoreDatabase, /GESTCOPY_ALLOW_PUBLIC_RESET=isolated-only/);
    assert.match(restoreDatabase, /GESTCOPY_PRODUCTION_PROJECT_REF/);
    assert.match(restoreDatabase, /GESTCOPY_RESTORE_TARGET_PROJECT_REF/);
    assert.match(restoreDatabase, /restore target resolves to Production project ref/);
    assert.match(restoreDatabase, /must not equal GESTCOPY_DATABASE_URL/);
    assert.match(restoreDatabase, /source_database_url="\$\{GESTCOPY_DATABASE_URL:-\}"/);
    assert.match(restoreDatabase, /pg_restore/);
    assert.match(restoreDatabase, /--section=/);
    assert.match(restoreDatabase, /--no-owner/);
    assert.match(restoreDatabase, /--exit-on-error/);
    assert.doesNotMatch(restoreDatabase, /--skip-auth/);
    assert.match(restoreDatabase, /pg_restore --list/);
    assert.match(restoreDatabase, /DROP SCHEMA IF EXISTS public CASCADE/);
    assert.match(restoreDatabase, /DROP SCHEMA IF EXISTS \$\{schema\} CASCADE/);
    assert.match(restoreDatabase, /CREATE SCHEMA public; GRANT USAGE ON SCHEMA public TO PUBLIC;/);
    assert.match(restoreDatabase, /APPLICATION_PRE_DATA_RESTORE_LIST/);
    assert.match(restoreDatabase, /--manifest PATH is required/);
    assert.match(restoreDatabase, /is not a multi-schema recovery set/);
    assert.match(restoreDatabase, /manifest does not declare required application schema/);
    assert.match(restoreDatabase, /application archive does not define schema \$\{schema\}/);
    assert.match(restoreDatabase, /which the manifest does not declare/);
    assert.match(restoreDatabase, /preflight_target_postgres_major/);
    assert.match(restoreDatabase, /compare_recovery_fingerprint/);
    assert.match(restoreDatabase, /does not match the recovery fingerprint/);
    assert.match(restoreDatabase, /application archive does not define schema public/);
    assert.match(restoreDatabase, /migrations archive does not define schema supabase_migrations/);
    assert.match(restoreDatabase, /migrations archive does not contain supabase_migrations\.schema_migrations data/);
    assert.match(restoreDatabase, /AUTH_RESTORE_LIST/);
    assert.match(restoreDatabase, /--use-list="\$\{AUTH_RESTORE_LIST\}"/);
    assert.match(restoreDatabase, /APPLICATION_POST_DATA_RESTORE_LIST/);
    assert.match(restoreDatabase, /DEFAULT ACL/);
    assert.match(restoreDatabase, /\$NF == "supabase_admin"/);
    assert.match(restoreDatabase, /pg_trgm@extensions/);
    assert.match(restoreDatabase, /preflight_target_extensions/);
    assert.match(restoreDatabase, /validate_restored_target/);
    assert.match(restoreDatabase, /post-restore semantic validation failed/);
    assert.ok(
      restoreDatabase.includes(
        "grep -Ev 'TABLE DATA[[:space:]]+auth[[:space:]]+schema_migrations"
      )
    );
    assert.doesNotMatch(
      stripComments(restoreDatabase),
      /--dbname="\$\{GESTCOPY_DATABASE_URL\}"/
    );

    const appRestore = stripComments(
      restoreDatabase.match(/restore_application_section[\s\S]*?^}/m)?.[0] ?? ""
    );
    assert.ok(appRestore, "application restore helper missing");
    assert.doesNotMatch(appRestore, /--no-privileges/);
  });

  it("does not hardcode secrets or rclone.conf credentials", () => {
    const corpus = [
      dockerfile,
      backupFiles,
      verifyFiles,
      backupAll,
      backupDatabase,
      restoreDatabase,
      recoveryContract,
      runnerLock,
      readme,
    ].join("\n");
    assert.equal(/AKIA[0-9A-Z]{16}/.test(corpus), false);
    assert.equal(/sk_live_|sk_test_/.test(corpus), false);
    assert.equal(/BEGIN (RSA |OPENSSH )?PRIVATE KEY/.test(corpus), false);
    assert.equal(/AGE-SECRET-KEY-1[A-Z0-9]+/i.test(corpus), false);
    assert.equal(/secret_access_key\s*=\s*\S+/i.test(corpus), false);
    assert.equal(
      /RCLONE_CONFIG_R2_SECRET_ACCESS_KEY=.+[^A-Z_]/.test(backupFiles),
      false
    );
    assert.match(readme, /No `rclone\.conf` with secrets/);
  });

  it("scripts are executable and pass bash -n", () => {
    const scripts = readdirSync(scriptsDir).filter((name) => name.endsWith(".sh"));
    assert.ok(scripts.length >= 5);
    assert.ok(scripts.includes("backup-database.sh"));
    assert.ok(scripts.includes("restore-database-local.sh"));
    assert.ok(scripts.includes("recovery-contract.sh"));

    for (const name of scripts) {
      const full = path.join(scriptsDir, name);
      accessSync(full, constants.X_OK);

      const syntax = spawnSync("bash", ["-n", full], { encoding: "utf8" });
      assert.equal(
        syntax.status,
        0,
        `bash -n failed for ${name}: ${syntax.stderr}`
      );
    }
  });

  it("documents Files + Database schedules, age key offline, and Object Lock", () => {
    assert.match(readme, /17 \* \* \* \*/);
    assert.match(readme, /35 2 \* \* 0/);
    assert.match(readme, /27 \*\/6 \* \* \*/);
    assert.match(readme, /\/app\/scripts\/backup-all\.sh/);
    assert.match(readme, /\/app\/scripts\/backup-database\.sh/);
    assert.match(readme, /\/infra\/backup-runner/);
    assert.match(readme, /Dockerfile Location/);
    assert.match(readme, /Do not use `rclone sync`/);
    assert.match(readme, /Object Lock/);
    assert.match(readme, /Compliance/);
    assert.match(readme, /GESTCOPY_BACKUP_AGE_RECIPIENT/);
    assert.match(readme, /age-keygen/);
    assert.match(readme, /private key/);
    assert.match(readme, /database\//);
    assert.match(readme, /exit 75/);
    assert.match(readme, /isolated/);
    assert.match(readme, /provider-native/);
    assert.match(readme, /exported snapshot|postgresql-exported-snapshot/);
    assert.match(readme, /INCOMPLETE BACKUP SET|incomplete/i);
    assert.match(readme, /completion marker|manifest\.json/);
    assert.match(readme, /GESTCOPY_PRODUCTION_PROJECT_REF/);
    assert.match(readme, /ACL|GRANT/);
    assert.match(readme, /pre-data/);
    assert.match(readme, /post-data/);
    assert.match(readme, /GESTCOPY_ALLOW_PUBLIC_RESET/);
    assert.match(readme, /DROP SCHEMA IF EXISTS public CASCADE/);
    assert.match(readme, /files_signing_secret/);
    assert.match(readme, /kiosk_signing_secret/);
    assert.match(readme, /imports_private/);
    assert.match(readme, /recovery fingerprint/);
    assert.match(readme, /GRANT USAGE ON SCHEMA public TO PUBLIC/);
    assert.match(readme, /backup-runner\.recovery\.test\.sh/);
    assert.match(readme, /supabase-automatic-rls/);
    assert.match(readme, /pg_trgm@extensions/);
    assert.match(readme, /Automatic RLS/);
    assert.match(readme, /27 public tables with RLS enabled \(27\/27\)/);
    assert.match(readme, /60 public policies/);
    assert.match(
      readme,
      /auth\.schema_migrations[\s\S]*excluded|excluded[\s\S]*auth\.schema_migrations/
    );
    assert.match(
      readme,
      /supabase_migrations[\s\S]*schema[\s\S]*data|schema[\s\S]*data[\s\S]*supabase_migrations/
    );
    assert.match(readme, /EXTERNAL RECOVERY REQUIREMENTS/);
    assert.match(readme, /GESTCOPY_SNAPSHOT_ACQUIRE_TIMEOUT_SECONDS/);
    assert.doesNotMatch(readme, /--skip-auth/);
  });
});
