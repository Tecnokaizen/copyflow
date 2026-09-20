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

describe("infra/backup-runner static contract", () => {
  const dockerfile = read("Dockerfile");
  const backupFiles = read("scripts/backup-files.sh");
  const verifyFiles = read("scripts/verify-files.sh");
  const backupAll = read("scripts/backup-all.sh");
  const readme = read("README.md");

  it("Dockerfile installs rclone, bash tooling, and postgres 17 client", () => {
    assert.match(dockerfile, /FROM alpine:3\.21/);
    assert.match(dockerfile, /\brclone\b/);
    assert.match(dockerfile, /\bbash\b/);
    assert.match(dockerfile, /\bjq\b/);
    assert.match(dockerfile, /\bcurl\b/);
    assert.match(dockerfile, /\bflock\b/);
    assert.match(dockerfile, /ca-certificates/);
    assert.match(dockerfile, /postgresql17-client/);
    assert.match(dockerfile, /sleep", "infinity/);
    assert.match(dockerfile, /USER backup/);
    // No Docker ENTRYPOINT instruction (comments mentioning the word are fine).
    assert.equal(/^\s*ENTRYPOINT\b/im.test(dockerfile), false);
  });

  it("backup-files uses rclone copy and never sync/delete", () => {
    const executable = backupFiles
      .replace(/^\s*#.*$/gm, "")
      .replace(/\$\{[^}]*HARD_DELETE[^}]*\}/g, "");
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

  it("backup-all runs the copy without a full verification", () => {
    assert.match(backupAll, /backup-files\.sh/);
    assert.doesNotMatch(backupAll, /verify-files\.sh/);
    assert.match(backupAll, /BACKUP_ALL_SUCCESS/);
    assert.match(backupAll, /B1\.3/);
  });

  it("does not hardcode secrets or rclone.conf credentials", () => {
    const corpus = [dockerfile, backupFiles, verifyFiles, backupAll, readme].join(
      "\n"
    );
    assert.equal(/AKIA[0-9A-Z]{16}/.test(corpus), false);
    assert.equal(/sk_live_|sk_test_/.test(corpus), false);
    assert.equal(/BEGIN (RSA |OPENSSH )?PRIVATE KEY/.test(corpus), false);
    assert.equal(/secret_access_key\s*=\s*\S+/i.test(corpus), false);
    assert.equal(/RCLONE_CONFIG_R2_SECRET_ACCESS_KEY=.+[^A-Z_]/.test(backupFiles), false);
    assert.match(readme, /No `rclone\.conf` with secrets/);
  });

  it("scripts are executable and pass bash -n", () => {
    const scripts = readdirSync(scriptsDir).filter((name) => name.endsWith(".sh"));
    assert.ok(scripts.length >= 3);

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

  it("documents Coolify schedule and forbids sync", () => {
    assert.match(readme, /17 \* \* \* \*/);
    assert.match(readme, /35 2 \* \* 0/);
    assert.match(readme, /\/app\/scripts\/backup-all\.sh/);
    assert.match(readme, /Do not use `rclone sync`/);
    assert.match(readme, /Object Lock/);
    assert.match(readme, /Compliance/);
  });
});
