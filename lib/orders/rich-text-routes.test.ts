import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, it } from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { NextRequest } from "next/server";

// The real order handlers with only the session and the database replaced: the
// server, not the browser, decides which text styles reach `orders`. Tenant
// isolation and roles of the RPC itself are covered by the SQL suites.
const root = path.resolve(import.meta.dirname, "../..");
const tenantA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const tenantB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const statusA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const orderA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
type Row = Record<string, unknown>;

const FORGED =
  '<p data-text-align="center" style="text-align:right;position:fixed" class="x"><span data-text-size="xlarge" data-text-color="red" style="position:fixed;inset:0" class="x" onmouseover="alert(1)">NO CORTAR</span>' +
  '<span data-text-color="url(javascript:alert(1))">x</span><img src=x onerror=alert(1)><script>alert(1)</script></p>' +
  '<p data-text-align="right;background:url(https://x.test/a.png)">y</p><p align="justify" data-text-align="left">z</p>';
const CLEAN = '<p data-text-align="center"><span data-text-size="xlarge" data-text-color="red">NO CORTAR</span>x</p><p>y</p><p>z</p>';

function harness(role: string | null = "staff") {
  const inserted: Row[] = [];
  const rpcCalls: Array<{ name: string; args: Row }> = [];
  const tables: Record<string, Row[]> = {
    order_statuses: [{ id: statusA, tenant_id: tenantA, active: true, is_initial: true }],
    orders: [{ id: orderA, tenant_id: tenantA }],
    tenant_settings: [{ tenant_id: tenantA, preferences: {} }],
  };
  const db = {
    from(table: string) {
      let rows = tables[table] ?? [];
      let single = false;
      const query = {
        select: () => query,
        eq(key: string, value: unknown) { rows = rows.filter((row) => row[key] === value); return query; },
        is(key: string, value: unknown) { rows = rows.filter((row) => row[key] === value); return query; },
        in: () => query,
        not: () => query,
        order: () => query,
        limit: () => query,
        maybeSingle() { single = true; return query; },
        single() { single = true; return query; },
        insert(row: Row) { inserted.push(row); rows = [{ ...row, id: orderA }]; return query; },
        then(resolve: (value: unknown) => void) { return Promise.resolve({ data: single ? rows[0] ?? null : rows, error: null }).then(resolve); },
      };
      return query;
    },
    async rpc(name: string, args: Row) {
      rpcCalls.push({ name, args });
      return { data: { order: { id: args.p_order_id, [String(args.p_field)]: args.p_value }, field: args.p_field, value: args.p_value, version: "2" }, error: null };
    },
  };
  function load(relative: string) {
    const filename = path.join(root, relative);
    const exports: Record<string, (...args: unknown[]) => Promise<Response>> = {};
    const realRequire = createRequire(filename);
    const compiled = ts.transpileModule(readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const context = { tenant: { id: tenantA, name: "Demo", slug: "demo" }, user: { id: "user-a" }, membership: { role, active: true } };
    vm.runInNewContext(compiled, {
      exports, console,
      require(id: string) {
        if (id === "@/lib/tenant/current-context") return { getCurrentContext: async () => (role ? context : null) };
        if (id === "@/lib/tenant/access-response") {
          const { NextResponse } = realRequire("next/server") as typeof import("next/server");
          return {
            requireCurrentAccess: async () => role
              ? { ok: true, context }
              : { ok: false, response: NextResponse.json({ error: "Session expired", code: "SESSION_EXPIRED" }, { status: 401 }) },
            roleDeniedResponse: () => NextResponse.json({ error: "Unauthorized or tenant access denied", code: "TENANT_ACCESS_DENIED" }, { status: 403 }),
          };
        }
        if (id === "@/lib/supabase/server") return { createClient: async () => db };
        if (id === "@/lib/team/current-member") return { resolveCurrentTeamMember: async () => null };
        return realRequire(id.startsWith("@/") ? path.join(root, id.slice(2)) : id);
      },
    }, { filename });
    return exports;
  }
  return { load, inserted, rpcCalls };
}

const request = (url: string, method: string, body: unknown) =>
  new NextRequest(url, { method, body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });

describe("order text styles through the API", () => {
  it("POST /api/orders stores sanitized styles under the session tenant", async () => {
    const app = harness();
    const response = await app.load("app/api/orders/route.ts").POST(
      request("http://localhost/api/orders", "POST", { title: "Trabajo", description: FORGED, notes: FORGED, tenant_id: tenantB })
    );
    assert.equal(response.status, 201);
    assert.equal(app.inserted[0].description, CLEAN);
    assert.equal(app.inserted[0].notes, CLEAN);
    assert.equal(app.inserted[0].tenant_id, tenantA);
  });

  it("PATCH content sanitizes instructions and notes before the RPC, under the session tenant", async () => {
    for (const field of ["description", "notes"]) {
      const app = harness();
      const response = await app.load("app/api/orders/[id]/content/route.ts").PATCH(
        request(`http://localhost/api/orders/${orderA}/content`, "PATCH", { field, value: FORGED, expected_version: "1", tenant_id: tenantB, p_tenant_id: tenantB }),
        { params: Promise.resolve({ id: orderA }) }
      );
      assert.equal(response.status, 200);
      assert.equal(app.rpcCalls.length, 1);
      assert.equal(app.rpcCalls[0].name, "change_order_content_v2");
      assert.equal(app.rpcCalls[0].args.p_value, CLEAN);
      assert.equal(app.rpcCalls[0].args.p_tenant_id, tenantA);
      assert.equal(app.rpcCalls[0].args.p_field, field);
    }
  });

  it("an empty styled value clears the field", async () => {
    const app = harness();
    await app.load("app/api/orders/[id]/content/route.ts").PATCH(
      request(`http://localhost/api/orders/${orderA}/content`, "PATCH", { field: "notes", value: '<p><span data-text-color="red"> </span></p>', expected_version: "1" }),
      { params: Promise.resolve({ id: orderA }) }
    );
    assert.equal(app.rpcCalls[0].args.p_value, null);
  });

  it("rejects writes without a session or with a viewer role before touching orders", async () => {
    const anonymous = harness(null);
    const patch = await anonymous.load("app/api/orders/[id]/content/route.ts").PATCH(
      request(`http://localhost/api/orders/${orderA}/content`, "PATCH", { field: "description", value: CLEAN, expected_version: "1" }),
      { params: Promise.resolve({ id: orderA }) }
    );
    assert.equal(patch.status, 403);
    assert.equal(anonymous.rpcCalls.length, 0);

    for (const role of ["viewer", null]) {
      const denied = harness(role);
      const post = await denied.load("app/api/orders/route.ts").POST(
        request("http://localhost/api/orders", "POST", { title: "Trabajo", description: CLEAN })
      );
      assert.equal(post.status, role ? 403 : 401);
      assert.equal(denied.inserted.length, 0);
    }
  });
});
