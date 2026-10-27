/**
 * S2 · explicit storage capacity
 * (20261018161000_billing_storage_capacity_explicit_v1.sql): never NULL,
 * last contracted capacity after a cancellation, 0 without a subscription,
 * and internal subscriptions only through the audited grant RPC.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { availableStorageBytes, storageUsagePercent } from "../settings/files";

const root = path.join(import.meta.dirname, "../..");
const read = (relative: string) => readFileSync(path.join(root, relative), "utf8");

const MIGRATION =
  "supabase/migrations/20261018161000_billing_storage_capacity_explicit_v1.sql";

function stripSqlComments(sql: string) {
  return sql.replace(/--[^\n]*/g, "");
}

describe("storage capacity is explicit (S2)", () => {
  it("resolves current plan, then last contracted, then 0; never NULL", () => {
    const sql = stripSqlComments(read(MIGRATION));
    for (const source of ["current_plan", "last_contracted", "no_contracted_capacity", "no_subscription"]) {
      assert.match(sql, new RegExp(`'${source}'`), source);
    }
    assert.match(
      sql,
      /return coalesce\(\s*\(public\.resolve_tenant_storage_capacity_v1\(p_tenant_id\) ->> 'limit_bytes'\)::bigint,\s*0\s*\);/
    );
    assert.match(sql, /'limit_bytes', 0/);
    // Only configured capacities count; an absent or NULL limit never does.
    assert.match(sql, /and pf\.limit_value is not null/);
  });

  it("guards and audits internal grants, with the shared billing lock", () => {
    const sql = stripSqlComments(read(MIGRATION));
    assert.match(sql, /create trigger subscriptions_internal_audit\s+after insert or update on public\.subscriptions/);
    assert.match(sql, /v_role in \('service_role', 'authenticated', 'anon'\)/);
    assert.match(sql, /'reason_required'/);
    assert.match(sql, /'authorization_required'/);
    assert.match(sql, /hashtextextended\(p_tenant_id::text, 31\)/);
    assert.match(sql, /revoke all on schema billing_private from public, anon, authenticated, service_role;/);
    assert.doesNotMatch(sql, /grant[^;]*to[^;]*\b(anon|authenticated|public)\b/i);
  });

  it("the Staging seed grants capacity only through the audited RPC, with an authorizer", () => {
    const seed = read("e2e/staging/seed.ts");
    assert.match(seed, /admin\.rpc\("grant_internal_subscription_v1"/);
    assert.match(seed, /E2E_CAPACITY_AUTHORIZED_BY/);
    assert.match(seed, /p_plan_code: "basic"/);
    assert.doesNotMatch(seed, /from\("subscriptions"\)\s*\.(insert|upsert|update)/);
    // create_internal_organization_v1 stays the way to create the organization.
    assert.match(seed, /create_internal_organization_v1/);
  });

  it("the files settings view handles capacity 0 without a percentage", () => {
    assert.equal(availableStorageBytes(1000, 0), 0);
    assert.equal(storageUsagePercent(1000, 0), null);
  });
});
