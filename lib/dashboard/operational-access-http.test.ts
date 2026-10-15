import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import ts from "typescript";
import { canReadOperationalOverview, canReadDashboardQuoteCounts } from "../orders/operational-access";

function harness(role: string | null) {
  const calls: Array<{ table: string; method: string; args: unknown[] }> = [];
  const supabase = {
    from(table: string) {
      const chain: Record<string, unknown> = {};
      for (const method of ["select", "eq", "gte", "lt", "not", "order", "range", "in", "is", "maybeSingle"]) {
        chain[method] = (...args: unknown[]) => { calls.push({ table, method, args }); return chain; };
      }
      chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: table === "tenant_settings" ? { timezone: "Europe/Madrid" } : [], count: 0, error: null }).then(resolve);
      return chain;
    },
    rpc: async (name: string, args: unknown) => { calls.push({ table: name, method: "rpc", args: [args] }); return { data: { members: [], active_orders_count: 0 }, error: null }; },
  };
  const deps: Record<string, unknown> = {
    "@/lib/orders/operational-access": { canReadOperationalOverview, canReadDashboardQuoteCounts },
    "@/lib/dashboard/quotes": { OPEN_QUOTE_STATUS_CODES: ["draft"] },
    "@/lib/features/tenant-has-feature": { tenantHasFeature: async () => true },
    "@/lib/http/operational-cache": { operationalJson: (body: unknown, init?: ResponseInit) => Response.json(body, init) },
    "@/lib/quotes/access": { canAccessQuotesModule: () => true },
    "@/lib/orders/operational": { applyOperationalOrdersFilter: (q: unknown) => q },
    "@/lib/orders/review": { NEEDS_ATTENTION_INCLUDES: {} },
    "@/lib/orders/review-load": { loadOperationalReviewOrders: async () => ({ orders: [], error: null }) },
    "@/lib/supabase/server": { createClient: async () => supabase },
    "@/lib/tenant/current-context": { getCurrentContext: async () => role === null ? null : ({ tenant: { id: "tenant-a", slug: "a" }, membership: { role, active: true } }) },
    "@/lib/team/types": { unwrapRpcPayload: (v: unknown) => v },
    "@/lib/team/rpc-error": {},
    "@/lib/time/zoned-day": { resolveTimeZone: () => "Europe/Madrid", getZonedDayBounds: () => ({ start: new Date("2026-10-09T00:00Z"), end: new Date("2026-10-10T00:00Z"), date: "2026-10-09" }) },
  };
  const code = ts.transpileModule(readFileSync(new URL("../../app/api/dashboard/route.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} as { GET: () => Promise<Response> } };
  new Function("require", "module", "exports", code)((name: string) => {
    if (!(name in deps)) throw new Error(`Unexpected dependency ${name}`);
    return deps[name];
  }, mod, mod.exports);
  return { calls, invoke: mod.exports.GET };
}

describe("operational dashboard authorization", () => {
  for (const role of [null, "unknown"]) it(`denies ${role} before querying`, async () => {
    const h = harness(role); assert.equal((await h.invoke()).status, 403); assert.equal(h.calls.length, 0);
  });
  for (const role of ["staff", "viewer"]) it(`${role} receives operational data without commercial counts`, async () => {
    const h = harness(role); const response = await h.invoke(); assert.equal(response.status, 200);
    const body = await response.json(); assert.equal(body.quotes, null); assert.equal(body.counts.active, 0);
    assert.equal(h.calls.some(c => c.table === "quotes"), false);
    for (const table of ["orders", "tenant_settings"]) assert.ok(h.calls.some(c => c.table === table && c.method === "eq" && c.args[0] === "tenant_id" && c.args[1] === "tenant-a"));
    assert.deepEqual(h.calls.find(c => c.method === "rpc")?.args, [{ p_tenant_id: "tenant-a", p_query: null, p_active: true }]);
  });
  it("preserves management quote counts", async () => {
    const h = harness("owner"); const body = await (await h.invoke()).json(); assert.equal(body.quotes.open, 0);
    assert.ok(h.calls.some(c => c.table === "quotes"));
  });
});
