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

  it("backup-database dumps public/auth/migrations, encrypts with age, and uploads safely", () => {
    const executable = stripComments(backupDatabase).replace(
      /\$\{[^}]*HARD_DELETE[^}]*\}/g,
      ""
    );
    assert.match(backupDatabase, /set -Eeuo pipefail/);
    assert.match(backupDatabase, /\bpg_dump\b/);
    assert.match(backupDatabase, /--schema=public/);
    assert.match(backupDatabase, /--schema=auth/);
    assert.match(backupDatabase, /--data-only/);
    assert.match(backupDatabase, /supabase_migrations\.schema_migrations/);
    assert.match(backupDatabase, /\bage\b/);
    assert.match(backupDatabase, /GESTCOPY_BACKUP_AGE_RECIPIENT/);
    assert.match(backupDatabase, /runner-lock\.sh/);
    assert.match(backupDatabase, /acquire_runner_lock/);
    assert.match(backupDatabase, /DATABASE_BACKUP_SUCCESS/);
    assert.match(backupDatabase, /\btrap\b/);
    assert.match(backupDatabase, /mktemp/);
    assert.match(backupDatabase, /\brclone copy\b/);
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
  });

  it("restore helper guards against production restores", () => {
    assert.match(restoreDatabase, /GESTCOPY_RESTORE_TARGET_URL/);
    assert.match(restoreDatabase, /GESTCOPY_ALLOW_RESTORE=isolated-only/);
    assert.match(restoreDatabase, /must not equal GESTCOPY_DATABASE_URL/);
    assert.match(restoreDatabase, /pg_restore/);
    assert.match(restoreDatabase, /--no-owner/);
    assert.match(restoreDatabase, /--no-privileges/);
    assert.match(restoreDatabase, /--exit-on-error/);
    assert.match(restoreDatabase, /--skip-auth/);
    assert.doesNotMatch(
      stripComments(restoreDatabase),
      /--dbname="\$\{GESTCOPY_DATABASE_URL\}"/
    );
  });

  it("does not hardcode secrets or rclone.conf credentials", () => {
    const corpus = [
      dockerfile,
      backupFiles,
      verifyFiles,
      backupAll,
      backupDatabase,
      restoreDatabase,
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
  });
});
