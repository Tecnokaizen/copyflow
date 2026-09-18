#!/usr/bin/env node
/**
 * Single smoke-test entrypoint for Cloud Agents: `npm run smoke`.
 *
 * Runs, in order:
 *   1. unit         (Vitest, pure logic)
 *   2. db           (pgTAP RLS/tenant isolation)
 *   3. integration  (Vitest, real HTTP API + RLS with real JWTs)
 *
 * - Ensures the local Supabase stack is up (brings it up if needed).
 * - Exits non-zero if any block fails and prints which block failed.
 * - Runs every block (does not stop at the first failure) so the report is complete.
 */
import { execSync, spawnSync } from "node:child_process";

function log(msg) {
  process.stdout.write(`\n\x1b[1m==> ${msg}\x1b[0m\n`);
}

function supabaseUp() {
  try {
    execSync("supabase status", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function ensureSupabase() {
  if (supabaseUp()) {
    return;
  }
  log("Supabase is not running — bringing the environment up");
  const res = spawnSync("bash", ["scripts/cloud-agent-start.sh"], {
    stdio: "inherit",
  });
  if (res.status !== 0 || !supabaseUp()) {
    console.error("ERROR: could not start the local Supabase stack.");
    process.exit(1);
  }
}

function resolveKeys() {
  const raw = execSync("supabase status -o env", { encoding: "utf8" });
  const map = new Map();
  for (const line of raw.split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) map.set(m[1], m[2].replace(/^"(.*)"$/, "$1"));
  }
  return {
    SMOKE_SUPABASE_URL: map.get("API_URL") || "http://127.0.0.1:54321",
    SMOKE_SUPABASE_KEY: map.get("PUBLISHABLE_KEY") || map.get("ANON_KEY") || "",
    SMOKE_SUPABASE_SERVICE_ROLE_KEY: map.get("SERVICE_ROLE_KEY") || "",
    SMOKE_APP_BASE_URL: process.env.SMOKE_APP_BASE_URL || "http://localhost:3000",
  };
}

const BLOCKS = [
  { name: "unit", cmd: "npx", args: ["vitest", "run", "--project", "unit"] },
  { name: "db", cmd: "supabase", args: ["test", "db", "supabase/tests/pgtap"] },
  {
    name: "integration",
    cmd: "npx",
    args: ["vitest", "run", "--project", "integration"],
  },
];

ensureSupabase();
const env = { ...process.env, ...resolveKeys() };

const results = [];
for (const block of BLOCKS) {
  log(`Running block: ${block.name}`);
  const res = spawnSync(block.cmd, block.args, { stdio: "inherit", env });
  results.push({ name: block.name, ok: res.status === 0 });
}

log("Smoke summary");
for (const r of results) {
  process.stdout.write(`  ${r.ok ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m"}  ${r.name}\n`);
}

const failed = results.filter((r) => !r.ok);
if (failed.length > 0) {
  console.error(`\nSmoke FAILED (${failed.map((r) => r.name).join(", ")}).`);
  process.exit(1);
}
process.stdout.write("\n\x1b[32mSmoke PASSED\x1b[0m\n");
