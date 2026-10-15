/**
 * Static guards for the Pro early access V1 restrictions
 * (docs/adr/2026-10-15-pro-early-access-v1.md): no microphone or simulated
 * voice, no tenant-specific conditions, no billing or service_role coupling,
 * an additive migration that grants nothing, and the SQL suite in the gate.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const root = path.join(import.meta.dirname, "../..");
const read = (relative: string) => readFileSync(path.join(root, relative), "utf8");

const PRO_SURFACE = [
  "app/pro/page.tsx",
  "app/api/context/route.ts",
  "components/pro/early-access-info.tsx",
  "components/pro/pro-early-access-badge.tsx",
  "lib/features/early-access.ts",
  "lib/features/early-access-server.ts",
  "lib/nav/pro-badge.ts",
];

const MIGRATION = "supabase/migrations/20261015200000_pro_early_access_features_v1.sql";

function stripSqlComments(sql: string) {
  return sql.replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

describe("Pro early access V1 guards", () => {
  it("never touches the microphone or speech APIs", () => {
    const forbidden = /getUserMedia|MediaRecorder|mediaDevices|SpeechRecognition|AudioContext/;
    for (const file of PRO_SURFACE) {
      assert.equal(forbidden.test(read(file)), false, file);
    }
  });

  it("has no tenant-specific conditions, service_role client or billing coupling", () => {
    const forbidden = [
      /\bslug\s*===/,
      /["'`]sur4["'`]/i,
      /createAdminClient/,
      /from\s+["']@\/lib\/billing/,
      /from\s+["']stripe["']/,
      /\.from\(\s*["'](subscriptions|plans|plan_features|billing_\w+)["']/,
      /api\/billing/,
    ];
    for (const file of PRO_SURFACE) {
      const source = read(file);
      for (const pattern of forbidden) {
        assert.equal(pattern.test(source), false, `${file} matches ${pattern}`);
      }
    }
  });

  it("guards /pro on the server and renders not found otherwise", () => {
    const page = read("app/pro/page.tsx");
    assert.equal(page.includes('"use client"'), false);
    assert.match(page, /proEarlyAccessGate\(/);
    assert.match(page, /getCurrentContext/);
    assert.match(page, /if \(!gate\.ok\) \{\s*notFound\(\);/);
  });

  it("announces voice orders without actions", () => {
    const info = read("components/pro/early-access-info.tsx");
    assert.match(info, /Gestcopy AI — Pedidos por voz/);
    assert.match(info, /En preparación/);
    assert.equal(/<button|<Button|onClick|href=/.test(info), false);
  });

  it("adds catalog rows only: no plan inheritance and no tenant grant", () => {
    const migrations = readdirSync(path.join(root, "supabase/migrations")).filter(
      (file) => read(`supabase/migrations/${file}`).includes("pro_early_access")
    );
    assert.deepEqual(migrations, [path.basename(MIGRATION)]);

    const sql = stripSqlComments(read(MIGRATION)).toLowerCase();
    assert.match(sql, /insert into public\.features/);
    for (const forbidden of [
      "plan_features",
      "tenant_feature_overrides",
      "set_tenant_feature",
      "subscriptions",
      "plans",
      "quotes",
      "delete",
      "update public.",
      "drop ",
    ]) {
      assert.equal(sql.includes(forbidden), false, `migration contains ${forbidden}`);
    }
  });

  it("runs the Pro SQL suite in the always-on release gate", () => {
    const workflow = read(".github/workflows/release-gate.yml");
    assert.match(workflow, /^\s+phase47_pro_early_access \\$/m);
  });
});
