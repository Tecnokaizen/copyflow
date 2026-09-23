import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, it } from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { NextRequest } from "next/server";

// Execute the real handlers, replacing only their external context/DB/storage boundaries.
// SQL suites independently exercise the actual RLS and database constraints.
const root = path.resolve(import.meta.dirname, "../..");
const tenantA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const tenantB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const statusA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const statusB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const orderA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const orderB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";
type Row = Record<string, unknown>;

function harness(role = "staff", tenant = tenantA) {
  const inserted: Row[] = [];
  const tables: Record<string, Row[]> = {
    file_statuses: [
      { id: statusA, tenant_id: tenantA, code: "pending", name: "Pendiente A", active: true },
      { id: statusB, tenant_id: tenantB, code: "ready", name: "Listo B", active: true },
    ],
    order_statuses: [{ id: statusA, tenant_id: tenantA, active: true, is_initial: true }],
    orders: [{ id: orderA, tenant_id: tenantA }, { id: orderB, tenant_id: tenantB }],
    order_files: [{ id: "file-a", order_id: orderA, tenant_id: tenantA, status: "ready", deleted_at: null, original_name: "a.pdf", size_bytes: 10 }],
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
        order: () => query,
        limit: () => query,
        maybeSingle() { single = true; return query; },
        single() { single = true; return query; },
        insert(row: Row) { inserted.push(row); rows = [{ ...row, id: orderA }]; return query; },
        then(resolve: (value: unknown) => void) { return Promise.resolve({ data: single ? rows[0] ?? null : rows, error: null }).then(resolve); },
      };
      return query;
    },
  };
  function load(relative: string) {
    const filename = path.join(root, relative);
    const exports: Record<string, (...args: never[]) => Promise<Response>> = {};
    const realRequire = createRequire(filename);
    const compiled = ts.transpileModule(readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    vm.runInNewContext(compiled, {
      exports, console,
      require(id: string) {
        if (id === "@/lib/tenant/current-context") return { getCurrentContext: async () => role === "none" ? null : ({ tenant: { id: tenant, slug: "demo" }, user: { id: "user-a" }, membership: { role, active: true } }) };
        if (id === "@/lib/supabase/server") return { createClient: async () => db };
        if (id === "@/lib/team/current-member") return { resolveCurrentTeamMember: async () => null };
        if (id === "@/lib/storage/r2") return { presignPut: async () => { throw new Error("Storage must not be reached for unauthorized requests"); } };
        return realRequire(id.startsWith("@/") ? path.join(root, id.slice(2)) : id);
      },
    }, { filename });
    return exports as Record<string, (...args: unknown[]) => Promise<Response>>;
  }
  return { load, inserted };
}

const request = (body: unknown) => new NextRequest("http://localhost/api/orders", { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });

describe("Pedido V2 route integration", () => {
  it("persists file_status_id on creation under the authenticated tenant, ignoring a forged tenant_id", async () => {
    const app = harness();
    const response = await app.load("app/api/orders/route.ts").POST(request({ title: "Trabajo", file_status_id: statusA, tenant_id: tenantB }));
    assert.equal(response.status, 201);
    assert.equal(app.inserted[0].file_status_id, statusA);
    assert.equal(app.inserted[0].tenant_id, tenantA);
    assert.equal(app.inserted[0].created_by, "user-a");
  });

  it("rejects foreign-tenant and malformed file status IDs before inserting", async () => {
    for (const value of [statusB, "not-a-uuid", 123, {}, []]) {
      const app = harness();
      const response = await app.load("app/api/orders/route.ts").POST(request({ title: "Trabajo", file_status_id: value }));
      assert.equal(response.status, 400);
      assert.equal(app.inserted.length, 0);
    }
  });

  it("retains old creation payloads and rejects viewer/unauthenticated writes", async () => {
    const app = harness();
    assert.equal((await app.load("app/api/orders/route.ts").POST(request({ title: "Legacy" }))).status, 201);
    assert.equal(app.inserted[0].file_status_id, null);
    for (const role of ["viewer", "none"]) {
      const denied = harness(role);
      assert.equal((await denied.load("app/api/orders/route.ts").POST(request({ title: "Trabajo" }))).status, 403);
      assert.equal(denied.inserted.length, 0);
    }
  });

  it("returns only active tenant file statuses, size limit and additive layout", async () => {
    const response = await harness().load("app/api/orders/options/route.ts").GET();
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.file_statuses.map((item: Row) => item.id), [statusA]);
    assert.equal(body.quick_order_layout.files, "more");
    assert.ok(body.max_file_bytes > 0);
    assert.match(response.headers.get("Cache-Control") ?? "", /no-store/);
  });

  it("lists saved order files and rejects cross-tenant LIST/INIT before storage", async () => {
    const files = harness().load("app/api/orders/[id]/files/route.ts");
    const listed = await files.GET(request({}), { params: Promise.resolve({ id: orderA }) });
    assert.equal(listed.status, 200);
    assert.equal((await listed.json()).files[0].original_name, "a.pdf");
    for (const action of ["GET", "POST"]) {
      const response = await files[action](request({ filename: "test.pdf", content_type: "application/pdf", size_bytes: 10 }), { params: Promise.resolve({ id: orderB }) });
      assert.equal(response.status, 404);
    }
    const viewer = harness("viewer").load("app/api/orders/[id]/files/route.ts");
    assert.equal((await viewer.POST(request({}), { params: Promise.resolve({ id: orderA }) })).status, 403);
  });
});
