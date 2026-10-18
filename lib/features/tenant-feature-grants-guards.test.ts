/**
 * Static guards for tenant feature grants V1 (Frente A1,
 * docs/TENANT-FEATURE-GRANTS-V1.md): an additive migration in its slot that
 * keeps the legacy feature functions, grants nothing to any tenant, never
 * expires a grant, exposes nothing to client roles, ships its rollback, and
 * runs its SQL suites in CI.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const root = path.join(import.meta.dirname, "../..");
const read = (relative: string) => readFileSync(path.join(root, relative), "utf8");

const VERSION = "20261017120000";
const MIGRATION = `supabase/migrations/${VERSION}_tenant_feature_grants_audit_v1.sql`;
const ROLLBACK = `supabase/rollbacks/${VERSION}_tenant_feature_grants_audit_v1.sql`;
const VERIFY = `supabase/rollbacks/verify_${VERSION}_tenant_feature_grants_audit_v1.sql`;
const SUITE = "supabase/tests/phase54_tenant_feature_grants.sql";
const CONCURRENCY = "supabase/tests/phase54_tenant_feature_grants_concurrency.sh";

const OPERATOR_FUNCTIONS = [
  "public.set_tenant_feature_v2(text, text, boolean, bigint, text, timestamp with time zone, text)",
  "public.clear_tenant_feature_override(text, text, text, text)",
  "public.list_tenant_feature_reviews_due(timestamp with time zone)",
];

function stripSqlComments(sql: string) {
  return sql.replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

describe("Tenant feature grants V1 guards", () => {
  it("takes the A1 slot: after order lines (#128), before voice orders (#90)", () => {
    assert.ok(readdirSync(path.join(root, "supabase/migrations")).includes(path.basename(MIGRATION)));
    assert.ok(VERSION > "20261016130000" && VERSION < "20261018150000");
  });

  it("keeps set_tenant_feature and tenant_has_feature as they are", () => {
    const sql = stripSqlComments(read(MIGRATION)).toLowerCase();
    assert.doesNotMatch(sql, /(create|alter|drop)\s+(or\s+replace\s+)?function\s+public\.set_tenant_feature\s*\(/);
    assert.doesNotMatch(sql, /(create|alter|drop)\s+(or\s+replace\s+)?function\s+public\.tenant_has_feature\s*\(/);
    assert.doesNotMatch(sql, /(revoke|grant)[^;]*public\.(set_tenant_feature|tenant_has_feature)\s*\(/);
  });

  it("grants nothing to tenants, never expires a grant and leaves billing alone", () => {
    const sql = stripSqlComments(read(MIGRATION)).toLowerCase();
    for (const forbidden of [
      /sur4/,
      /\bcron\./,
      /public\.(plans|plan_features|subscriptions|billing_\w+)\b/,
      /insert\s+into\s+public\.features/,
    ]) {
      assert.equal(forbidden.test(sql), false, `migration matches ${forbidden}`);
    }
    // Outside function bodies (what runs at migration time) no override is written.
    const executable = sql.replace(/\$function\$[\s\S]*?\$function\$/g, " ");
    assert.doesNotMatch(executable, /(insert\s+into|update|delete\s+from)\s+public\.tenant_feature_overrides\b/);
  });

  it("exposes the operator functions to service_role only", () => {
    const sql = stripSqlComments(read(MIGRATION)).replace(/'(?:[^']|'')*'/g, "''");
    const grants = [...sql.matchAll(/\bgrant\b[^;]*;/gi)].map((match) => match[0].replace(/\s+/g, " "));
    assert.equal(grants.length, OPERATOR_FUNCTIONS.length);
    for (const grant of grants) {
      assert.match(grant, /^grant execute on function public\.\w+\(.*\) to service_role;$/);
    }
    for (const signature of OPERATOR_FUNCTIONS) {
      const revoke = `revoke all on function ${signature} from public, anon, authenticated;`;
      assert.ok(sql.replace(/\s+/g, " ").includes(revoke), `missing: ${revoke}`);
    }
    assert.match(
      sql.replace(/\s+/g, " "),
      /revoke all on table public\.tenant_feature_override_events from public, anon, authenticated, service_role;/
    );
  });

  it("ships an exact rollback that refuses to drop history silently", () => {
    const rollback = read(ROLLBACK);
    assert.match(rollback, /rollback_tenant_feature_grants_refused/);
    assert.match(rollback, /drop table public\.tenant_feature_override_events;/);
    assert.match(rollback, /grant truncate on table public\.tenant_feature_overrides to service_role;/);
    assert.doesNotMatch(stripSqlComments(rollback), /set_tenant_feature\s*\(\s*'/);
    assert.match(read(VERIFY), /ROLLBACK FAIL/);
  });

  it("runs the SQL suite in the release gate and the concurrency script in kiosk-supabase", () => {
    assert.match(read(".github/workflows/release-gate.yml"), /^\s+phase54_tenant_feature_grants \\$/m);
    const kiosk = read(".github/workflows/kiosk-supabase.yml");
    assert.match(kiosk, /^\s+- "supabase\/tests\/phase54_tenant_feature_grants\*"$/m);
    assert.match(
      kiosk,
      /^\s+bash supabase\/tests\/phase54_tenant_feature_grants_concurrency\.sh "\$\{LOCAL_DB_URL\}"$/m
    );
    assert.match(read(SUITE), /phase54 tenant feature grants PASS/);
    assert.match(read(CONCURRENCY), /phase54 tenant feature grants concurrency PASS/);
  });
});
