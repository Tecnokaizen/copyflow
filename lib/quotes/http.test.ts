import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, it } from "node:test";
import ts from "typescript";
import * as commercial from "./commercial";
import * as payload from "./payload";
import * as types from "./types";
import * as errors from "./errors";
import { isUuid } from "../team/payload";

const ID = "11111111-1111-4111-8111-111111111111";
const VERSION = "22222222-2222-4222-8222-222222222222";
const version = {
  id: VERSION, quote_id: ID, version_number: 2, state: "draft",
  description: "Material", issue_date: "2026-10-05", currency: "EUR",
  subtotal: "100.00", tax_total: "21.00", total: "121.00", tax_breakdown: [],
  created_at: "2026-10-05T12:00:00Z", row_version: 4,
};
const quote = {
  ...version, id: ID, reference: "P-0001", updated_at: version.created_at,
  current_version_id: VERSION, current_version: { version_number: 2, state: "prepared" },
  status: { id: ID, name: "Borrador", code: "draft" },
};
const input = {
  version_id: VERSION, expected_row_version: 4,
  header: { description: "Material", issue_date: "2026-10-05", currency: "EUR", prices_include_tax: false, total: "0" },
  items: [{ concept: "Impresión", quantity: "1", unit_price: "100", tax_rate: "21", total: "0" }],
  tenant_id: "tenant-b", total: "0",
};

function harness(route: string, options: { denied?: number; missing?: boolean; rpcBody?: unknown; updateError?: { code: string; message: string } } = {}) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const filters: Array<[string, unknown]> = [];
  const supabase = {
    from(table: string) {
      const chain = {
        update(args: Record<string, unknown>) { calls.push({ name: "update", args }); return chain; },
        select() { return chain; },
        eq(key: string, value: unknown) { filters.push([key, value]); return chain; },
        order() { return chain; },
        maybeSingle: async () => ({ data: options.missing ? null : table === "quotes" ? quote : version, error: options.updateError ?? null }),
        then(resolve: (value: unknown) => unknown) {
          return Promise.resolve({ data: table === "quote_versions" ? [version] : [], error: options.updateError ?? null }).then(resolve);
        },
      };
      return chain;
    },
    async rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      return { data: options.rpcBody ?? { ok: true, version }, error: null };
    },
  };
  const json = (body: unknown, init?: ResponseInit) => Response.json(body, init);
  const dependencies: Record<string, unknown> = {
    "@/lib/quotes/guard": { requireQuotesAccess: async () => options.denied
      ? { ok: false, response: json({ error: "denied" }, { status: options.denied }) }
      : { ok: true, supabase, context: { tenant: { id: "tenant-a", slug: "a" } } } },
    "@/lib/http/operational-cache": { operationalJson: json },
    "@/lib/quotes/commercial": commercial,
    "@/lib/quotes/payload": payload,
    "@/lib/quotes/types": types,
    "@/lib/quotes/errors": errors,
    "@/lib/team/payload": { isUuid },
    "@/lib/quotes/relations": { relationBelongsToTenant: async () => false },
  };
  const filename = new URL(`../../app/api/quotes/[id]/${route ? `${route}/` : ""}route.ts`, import.meta.url);
  const compiled = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const routeModule = { exports: {} as Record<string, (req: Request, context: unknown) => Promise<Response>> };
  const nativeRequire = createRequire(import.meta.url);
  new Function("require", "module", "exports", compiled)(
    (name: string) => dependencies[name] ?? nativeRequire(name), routeModule, routeModule.exports
  );
  return { calls, filters, invoke: (method: string, body: unknown = input) => routeModule.exports[method](
    new Request("http://a.local/api/quotes/" + ID, { method, ...(method === "GET" ? {} : { body: JSON.stringify(body) }) }),
    { params: Promise.resolve({ id: ID }) }
  ) };
}

describe("commercial HTTP handlers", () => {
  it("returns authentication, role and feature failures before database access", async () => {
    for (const denied of [401, 403, 404]) {
      for (const route of ["draft", "versions", "prepare", ""]) {
        const h = harness(route, { denied });
        assert.equal((await h.invoke(route ? "POST" : "GET")).status, denied);
        assert.equal(h.calls.length, 0);
        assert.equal(h.filters.length, 0);
      }
    }
  });
  it("hides other-host tenant quotes even for a user with multiple memberships", async () => {
    for (const route of ["draft", "versions", "prepare", ""]) {
      const h = harness(route, { missing: true });
      assert.equal((await h.invoke(route ? "POST" : "GET")).status, 404);
      assert.equal(h.calls.length, 0);
      assert.ok(h.filters.some(([key, value]) => key === "tenant_id" && value === "tenant-a"));
    }
    const draft = harness("draft", { missing: true });
    assert.equal((await draft.invoke("PUT")).status, 404);
    assert.equal(draft.calls.length, 0);
  });
  it("saves allowlisted input and returns authoritative database totals", async () => {
    const h = harness("draft");
    const response = await h.invoke("PUT");
    assert.equal(response.status, 200);
    assert.equal((await response.json()).totals.total, "121.00");
    assert.equal(h.calls[0].name, "save_quote_draft_v1");
    assert.equal("tenant_id" in h.calls[0].args, false);
    assert.equal("total" in (h.calls[0].args.p_header as object), false);
    assert.equal("total" in (h.calls[0].args.p_items as object[])[0], false);
  });
  it("maps stale edits, foreign versions and immutable drafts to HTTP errors", async () => {
    for (const [error, status] of [["conflict", 409], ["not_found", 404], ["immutable_version", 409], ["items_required", 422]] as const) {
      const h = harness("draft", { rpcBody: { ok: false, error, row_version: 8 } });
      const response = await h.invoke("PUT");
      assert.equal(response.status, status);
      const body = await response.json();
      if (error === "conflict") assert.equal(body.current_row_version, 8);
    }
  });
  it("prepares through RPC and preserves the quote draft status", async () => {
    const h = harness("prepare", { rpcBody: { ok: true, version: { ...version, state: "prepared" } } });
    const response = await h.invoke("POST");
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.prepared_version.state, "prepared");
    assert.equal(body.quote.status.code, "draft");
    assert.equal(h.calls[0].name, "prepare_quote_version_v1");
  });
  it("returns one draft on a repeated new-version submission", async () => {
    const h = harness("versions", { rpcBody: { ok: false, error: "draft_exists" } });
    const response = await h.invoke("POST");
    assert.equal(response.status, 200);
    assert.equal((await response.json()).replayed, true);
    assert.equal(h.calls.length, 1);
  });
  it("returns current items and summarized history without snapshots", async () => {
    const h = harness("");
    const response = await h.invoke("GET");
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.current_version.id, VERSION);
    assert.equal(body.versions[0].version_number, 2);
    assert.equal("description" in body.versions[0], false);
    assert.equal("seller_snapshot" in body.current_version, false);
  });
});

describe("operational partial PATCH compatibility", () => {
  it("updates only operational columns with tenant and quote concurrency scope", async () => {
    const h = harness("");
    const response = await h.invoke("PATCH", { operational_only: true, expected_row_version: 99, client_id: null, service_id: null, assigned_team_member_id: null });
    assert.equal(response.status, 200);
    assert.deepEqual(h.calls[0].args, { client_id: null, service_id: null, assigned_team_member_id: null });
    assert.ok(h.filters.some(([key, value]) => key === "row_version" && value === 99));
    assert.ok(h.filters.some(([key, value]) => key === "tenant_id" && value === "tenant-a"));
  });
  it("returns a conflict when the database protects a locked client", async () => {
    const h = harness("", { updateError: { code: "55000", message: "locked_quote_client" } });
    const response = await h.invoke("PATCH", { operational_only: true, expected_row_version: 99, client_id: null, service_id: null, assigned_team_member_id: null });
    assert.equal(response.status, 409);
    assert.equal((await response.json()).code, "locked_quote_client");
  });
  it("still accepts the old full operational form", async () => {
    const h = harness("");
    const response = await h.invoke("PATCH", { expected_row_version: 99, title: "Old form", description: "Trabajo", notes: "Notas", client_id: null, service_id: null, assigned_team_member_id: null });
    assert.equal(response.status, 200);
    assert.equal(h.calls[0].args.title, "Old form");
  });
});
