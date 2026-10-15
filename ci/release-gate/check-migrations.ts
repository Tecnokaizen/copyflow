/**
 * CLI: npx tsx ci/release-gate/check-migrations.ts [--base <git-ref>]
 *
 * Compares HEAD with the base revision (PR base SHA, or the previous main
 * commit on push). Read-only: only runs git plumbing commands.
 */
import { execFileSync } from "node:child_process";
import {
  MIGRATIONS_DIR,
  type MigrationChange,
  blockingFindings,
  checkMigrationChanges,
} from "./migration-guard";

function git(args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

function refExists(ref: string): boolean {
  try {
    git(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

function resolveBase(requested: string | undefined): string {
  if (requested && !/^0+$/.test(requested) && refExists(requested)) {
    return git(["merge-base", requested, "HEAD"]).trim();
  }
  if (refExists("origin/main")) {
    const mergeBase = git(["merge-base", "origin/main", "HEAD"]).trim();
    const head = git(["rev-parse", "HEAD"]).trim();
    if (mergeBase !== head) return mergeBase;
  }
  if (refExists("HEAD~1")) return git(["rev-parse", "HEAD~1"]).trim();
  throw new Error("cannot resolve a base revision; fetch history (fetch-depth: 0)");
}

function parseNameStatus(output: string): MigrationChange[] {
  return output
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [status, first, second] = line.split("\t");
      return second
        ? { status, path: second, previousPath: first }
        : { status, path: first };
    });
}

function main() {
  const index = process.argv.indexOf("--base");
  const base = resolveBase(index > -1 ? process.argv[index + 1] : process.env.RELEASE_GATE_BASE);

  const changes = parseNameStatus(
    git(["diff", "--name-status", "--find-renames", `${base}...HEAD`, "--", MIGRATIONS_DIR])
  );
  const baseFiles = git(["ls-tree", "-r", "--name-only", base, "--", MIGRATIONS_DIR])
    .split("\n")
    .filter(Boolean);

  const findings = checkMigrationChanges(changes, baseFiles, (path) =>
    git(["show", `HEAD:${path}`])
  );
  const blocking = blockingFindings(findings);

  console.log(`migration guard: base ${base.slice(0, 12)}, ${changes.length} migration change(s)`);
  for (const finding of findings) {
    const level = finding.waived ? "WAIVED" : "ERROR";
    console.log(`${level} [${finding.rule}] ${finding.file}: ${finding.message}`);
    if (finding.waived) console.log(`       reason: ${finding.waived}`);
  }

  if (blocking.length > 0) {
    console.error(`migration guard: FAIL (${blocking.length} blocking finding(s))`);
    process.exit(1);
  }
  console.log("migration guard: PASS");
}

main();
