import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  PROTECTED_PROJECT_REFS,
  STAGING_E2E_WORKFLOW,
  checkTrackedFile,
  checkWorkflow,
} from "./production-safety";

const root = path.join(import.meta.dirname, "../..");
// The guard itself must name the refs it protects.
const REF_ALLOWLIST = new Set(["ci/release-gate/production-safety.ts"]);
const BINARY = /\.(png|jpe?g|gif|webp|ico|pdf|woff2?|ttf|otf|zip|gz)$/i;

function trackedFiles(): string[] {
  return execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" })
    .split("\0")
    .filter(Boolean);
}

const SAFE_WORKFLOW = `name: Gate
on:
  pull_request:
permissions:
  contents: read
jobs:
  db:
    runs-on: ubuntu-latest
    steps:
      - run: psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -f x.sql
`;

describe("production safety: workflow rules", () => {
  it("accepts a read-only local workflow", () => {
    assert.deepEqual(checkWorkflow("w.yml", SAFE_WORKFLOW), []);
  });

  for (const [label, line] of [
    ["remote migration", "      - run: npx supabase@2.117.0 db push --linked"],
    ["supabase link", "      - run: npx supabase link --project-ref abc"],
    ["vercel deploy", "      - run: npx vercel deploy --prod"],
    ["secrets", "      - run: echo ${{ secrets.ANYTHING }}"],
    ["credential name", "      - run: echo $SUPABASE_ACCESS_TOKEN"],
    ["remote database", "      - run: psql postgresql://u:p@db.example.supabase.co:5432/postgres"],
  ]) {
    it(`rejects ${label}`, () => {
      assert.ok(checkWorkflow("w.yml", SAFE_WORKFLOW + line + "\n").length > 0);
    });
  }

  it("rejects write tokens, missing permissions and pull_request_target", () => {
    assert.ok(checkWorkflow("w.yml", SAFE_WORKFLOW.replace("contents: read", "contents: write")).length > 0);
    assert.ok(checkWorkflow("w.yml", SAFE_WORKFLOW.replace("permissions:\n  contents: read\n", "")).length > 0);
    assert.ok(checkWorkflow("w.yml", SAFE_WORKFLOW.replace("pull_request:", "pull_request_target:")).length > 0);
  });
});

const STAGING_E2E = `name: E2E staging
on:
  workflow_dispatch:
permissions:
  contents: read
jobs:
  e2e:
    runs-on: ubuntu-latest
    environment: staging
    steps:
      - run: node run.mjs
        env:
          E2E_USER_PASSWORD: \${{ secrets.E2E_USER_PASSWORD }}
`;

describe("production safety: staging E2E workflow exception", () => {
  it("accepts the manual staging workflow with allowlisted secrets", () => {
    assert.deepEqual(checkWorkflow(STAGING_E2E_WORKFLOW, STAGING_E2E), []);
  });

  it("keeps rejecting secrets in any other workflow", () => {
    assert.ok(checkWorkflow(".github/workflows/other.yml", STAGING_E2E).length > 0);
  });

  for (const [label, content] of [
    ["automatic trigger", STAGING_E2E.replace("  workflow_dispatch:\n", "  workflow_dispatch:\n  pull_request:\n")],
    ["push trigger", STAGING_E2E.replace("  workflow_dispatch:\n", "  push:\n")],
    ["missing environment", STAGING_E2E.replace("    environment: staging\n", "")],
    ["other environment", STAGING_E2E.replace("environment: staging", "environment: production")],
    ["non-allowlisted secret", STAGING_E2E + "          X: \${{ secrets.SUPABASE_PROD_KEY }}\n"],
    ["production credential name", STAGING_E2E + "          SUPABASE_SECRET_KEY: x\n"],
    ["write token", STAGING_E2E.replace("contents: read", "contents: write")],
  ]) {
    it(`rejects ${label}`, () => {
      assert.ok(checkWorkflow(STAGING_E2E_WORKFLOW, content).length > 0);
    });
  }
});

describe("production safety: repository rules", () => {
  it("rejects committed env files and real values in .env.example", () => {
    assert.equal(checkTrackedFile(".env.production", "X=1").length, 1);
    assert.equal(checkTrackedFile(".env.example", "A=your-value\n# B=commented\n").length, 0);
    assert.equal(checkTrackedFile(".env.example", "A=abc123realvalue").length, 1);
  });

  it("rejects project refs outside docs and credential-looking strings", () => {
    const ref = PROTECTED_PROJECT_REFS[0];
    assert.equal(checkTrackedFile("lib/x.ts", `const url = "https://${ref}.supabase.co"`).length, 1);
    assert.equal(checkTrackedFile("docs/x.md", `project ${ref}`).length, 0);
    const fakeStripe = ["sk", "live", "a".repeat(24)].join("_");
    assert.equal(checkTrackedFile("lib/x.ts", fakeStripe).length, 1);
    const fakeSupabase = "sb_" + "secret_" + "b".repeat(20);
    assert.equal(checkTrackedFile("lib/x.ts", fakeSupabase).length, 1);
  });

  it("allows only the public local supabase-demo JWT", () => {
    const jwt = (claims: object) =>
      ["eyJhbGciOiJIUzI1NiJ9", Buffer.from(JSON.stringify(claims)).toString("base64url"), "c".repeat(43)].join(".");
    assert.equal(checkTrackedFile("lib/x.ts", jwt({ iss: "supabase-demo", role: "service_role", pad: "x".repeat(10) })).length, 0);
    assert.equal(checkTrackedFile("lib/x.ts", jwt({ iss: "supabase", ref: "abcdefghij", role: "service_role" })).length, 1);
  });

  it("every workflow in the repository is production-safe", () => {
    const workflows = trackedFiles().filter((f) => f.startsWith(".github/workflows/"));
    assert.ok(workflows.length > 0);
    const findings = workflows.flatMap((f) => checkWorkflow(f, readFileSync(path.join(root, f), "utf8")));
    assert.deepEqual(findings, []);
  });

  it("no tracked file exposes production refs, env files or credentials", () => {
    const findings = trackedFiles()
      .filter((f) => !BINARY.test(f) && f !== "package-lock.json")
      .flatMap((f) => {
        const content = readFileSync(path.join(root, f), "utf8");
        return checkTrackedFile(f, content).filter(
          (finding) => !(REF_ALLOWLIST.has(f) && finding.message.includes("project ref"))
        );
      });
    assert.deepEqual(findings, []);
  });
});
