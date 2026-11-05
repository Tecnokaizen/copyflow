import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, it } from "node:test";
import ts from "typescript";
import * as collection from "./collection";
import * as items from "./items";
import * as money from "./money";
import * as concurrency from "./concurrency";
import { isUuid } from "../team/payload";

const ID = "11111111-1111-4111-8111-111111111111";
const order = {
  id: ID, total_amount: "40.00", total_mode: "manual", prices_include_tax: false,
  items_subtotal: "0.00", items_tax_total: "0.00", items_total: "0.00", row_version: "4",
};
const line = { concept: "Copias", description: null, quantity: "100", unit: "ud", unit_price: "0.10", discount_percent: "0", tax_rate: "21" };
const savedLine = {
  id: "i1", position: 1, concept: "Copias", description: null, quantity: "100.000000", unit: "ud",
  unit_price: "0.100000", discount_percent: "0.000000", tax_rate: "21.000000", subtotal: "10.00", tax_amount: "2.10", total: "12.10",
};
const snapshot = {
  total_amount: "12.10", paid_amount: "0.00", pending_amount: "12.10", collection_state: "unpaid", row_version: "5", payments: [],
};

type Options = { current?: boolean; missing?: boolean; rpcBody?: unknown; rpcError?: unknown };

function harness(route: "items" | "total", options: Options = {}) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const filters: Array<[string, string, unknown]> = [];
  const selects: Array<[string, string]> = [];
  const tables: string[] = [];
  const orders: Array<[string, unknown]> = [];
  const supabase = {
    from(table: string) {
      tables.push(table);
      const chain = {
        select(columns: string) { selects.push([table, columns]); return chain; },
        eq(key: string, value: unknown) { filters.push([table, key, value]); return chain; },
        in() { return chain; },
        order(column: string, opts?: unknown) { orders.push([column, opts]); return chain; },
        maybeSingle: async () => ({ data: options.missing ? null : { ...order, order_items: [savedLine] }, error: null }),
        then(resolve: (value: unknown) => unknown) {
          return Promise.resolve({ data: table === "order_items" ? [savedLine] : [], error: null }).then(resolve);
        },
      };
      return chain;
    },
    async rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      return { data: options.rpcBody ?? { ok: true }, error: options.rpcError ?? null };
    },
  };
  const json = (body: unknown, init?: ResponseInit) => Response.json(body, init);
  const dependencies: Record<string, unknown> = {
    "next/server": {},
    "@/lib/http/operational-cache": { operationalJson: json },
    "@/lib/orders/collection": collection,
    "@/lib/orders/items": items,
    "@/lib/orders/money": money,
    "@/lib/orders/concurrency": concurrency,
    "@/lib/orders/profile-names": { loadProfileNames: async () => [] },
    "@/lib/supabase/server": { createClient: async () => supabase },
    "@/lib/team/payload": { isUuid },
    "@/lib/tenant/current-context": {
      getCurrentContext: async () => (options.current === false ? null : { tenant: { id: "tenant-a" } }),
    },
  };
  const filename = new URL(`../../app/api/orders/[id]/${route}/route.ts`, import.meta.url);
  const compiled = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const routeModule = { exports: {} as Record<string, (req: Request, context: unknown) => Promise<Response>> };
  const nativeRequire = createRequire(import.meta.url);
  new Function("require", "module", "exports", compiled)(
    (name: string) => dependencies[name] ?? nativeRequire(name), routeModule, routeModule.exports,
  );
  return {
    calls, filters, selects, tables, orders,
    invoke: (method: string, body?: unknown, id = ID) => routeModule.exports[method](
      new Request(`http://a.local/api/orders/${id}/${route}`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }),
      { params: Promise.resolve({ id }) },
    ),
  };
}

const putBody = { expected_version: "4", prices_include_tax: true, items: [line] };

describe("GET /api/orders/[id]/items", () => {
  it("reads total, mode, version and lines of the current tenant in ONE request, as exact text", async () => {
    const h = harness("items");
    const response = await h.invoke("GET");
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.total_mode, "manual");
    assert.equal(body.total_amount, "40.00");
    assert.equal(body.row_version, "4");
    assert.equal(body.items[0].quantity, "100");
    assert.equal(body.items[0].total, "12.10");
    // A single embedded read is a single SQL statement: one snapshot, so a
    // write landing between "read the order" and "read the lines" cannot mix them.
    assert.deepEqual(h.tables, ["orders"]);
    assert.deepEqual(h.selects, [["orders", items.ORDER_TOTAL_SNAPSHOT_SELECT]]);
    assert.deepEqual(h.orders, [["position", { referencedTable: "order_items" }]]);
    assert.ok(h.filters.some(([table, key, value]) => table === "orders" && key === "tenant_id" && value === "tenant-a"));
    assert.ok(h.filters.some(([table, key, value]) => table === "orders" && key === "id" && value === ID));
  });

  it("requires a tenant session, a uuid and an order of the tenant", async () => {
    assert.equal((await harness("items", { current: false }).invoke("GET")).status, 403);
    assert.equal((await harness("items").invoke("GET", undefined, "nope")).status, 404);
    assert.equal((await harness("items", { missing: true }).invoke("GET")).status, 404);
  });
});

describe("PUT /api/orders/[id]/items", () => {
  it("saves lines in items mode with the chosen VAT treatment", async () => {
    const h = harness("items", { rpcBody: { ok: true, total_mode: "items", prices_include_tax: true, items_subtotal: "10.00", items_tax_total: "2.10", items_total: "12.10", items: [savedLine], ...snapshot } });
    const response = await h.invoke("PUT", putBody);
    assert.equal(response.status, 200);
    assert.deepEqual(h.calls[0], {
      name: "replace_order_items_v1",
      args: { p_order_id: ID, p_expected_row_version: "4", p_items: [{ ...line, unit_price: "0.1" }], p_total_mode: "items", p_prices_include_tax: true },
    });
    const body = await response.json();
    assert.equal(body.items.total_mode, "items");
    assert.equal(body.items.row_version, "5");
    assert.equal(body.collection.total_amount, "12.10");
  });

  it("never calls the database with an invalid payload", async () => {
    for (const body of [{ ...putBody, items: [] }, { ...putBody, items: [{ ...line, total: "1" }] }, { ...putBody, prices_include_tax: "yes" }]) {
      const h = harness("items");
      assert.equal((await h.invoke("PUT", body)).status, 422);
      assert.equal(h.calls.length, 0);
    }
    const h = harness("items");
    const response = await h.invoke("PUT", { ...putBody, expected_version: undefined });
    assert.equal(response.status, 409);
    assert.equal((await response.json()).code, "conflict");
    assert.equal(h.calls.length, 0);
  });

  it("checks the tenant before writing", async () => {
    const h = harness("items", { missing: true });
    assert.equal((await h.invoke("PUT", putBody)).status, 404);
    assert.equal(h.calls.length, 0);
    assert.equal((await harness("items", { current: false }).invoke("PUT", putBody)).status, 403);
  });

  it("maps database refusals", async () => {
    const cases: Array<[unknown, number, string | undefined]> = [
      [{ ok: false, error: "total_below_paid" }, 422, undefined],
      [{ ok: false, error: "conflict", row_version: "9" }, 409, "conflict"],
      [{ ok: false, error: "forbidden" }, 403, undefined],
      [{ ok: false, error: "order_archived" }, 409, undefined],
      [{ ok: false, error: "invalid_items", index: 0, field: "tax_rate" }, 422, undefined],
    ];
    for (const [rpcBody, status, code] of cases) {
      const response = await harness("items", { rpcBody }).invoke("PUT", putBody);
      assert.equal(response.status, status, JSON.stringify(rpcBody));
      const body = await response.json();
      assert.equal(body.code, code);
    }
    assert.equal((await harness("items", { rpcError: { message: "boom" } }).invoke("PUT", putBody)).status, 500);
  });
});

describe("PATCH /api/orders/[id]/total", () => {
  it("keeps the legacy RPC for a manual order", async () => {
    const h = harness("total", { rpcBody: { ok: true, ...snapshot } });
    assert.equal((await h.invoke("PATCH", { total_amount: "12,10", expected_version: "4" })).status, 200);
    assert.deepEqual(h.calls[0], { name: "set_order_total_amount", args: { p_order_id: ID, p_total: "12.10", p_expected_row_version: "4" } });
  });

  it("leaves items mode atomically with leave_items", async () => {
    const h = harness("total", { rpcBody: { ok: true, total_mode: "manual", ...snapshot } });
    assert.equal((await h.invoke("PATCH", { total_amount: "30", expected_version: "4", leave_items: true })).status, 200);
    assert.deepEqual(h.calls[0], { name: "set_order_manual_total_v1", args: { p_order_id: ID, p_total: "30.00", p_expected_row_version: "4" } });
  });

  it("only a literal true selects the switch", async () => {
    const h = harness("total", { rpcBody: { ok: true, ...snapshot } });
    await h.invoke("PATCH", { total_amount: "30", expected_version: "4", leave_items: "true" });
    assert.equal(h.calls[0].name, "set_order_total_amount");
  });

  it("explains total_mode_items and total_below_paid", async () => {
    let response = await harness("total", { rpcBody: { ok: false, error: "total_mode_items" } }).invoke("PATCH", { total_amount: "30", expected_version: "4" });
    assert.equal(response.status, 409);
    assert.match((await response.json()).error, /partidas/);
    response = await harness("total", { rpcBody: { ok: false, error: "total_below_paid" } }).invoke("PATCH", { total_amount: "1", expected_version: "4", leave_items: true });
    assert.equal(response.status, 422);
  });
});
