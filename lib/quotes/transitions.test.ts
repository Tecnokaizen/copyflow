import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, it } from "node:test";
import ts from "typescript";
import { transitionFailure } from "./transition-result";
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

function harness(route: string, options: { denied?: number; missing?: boolean; rpcBody?: unknown } = {}) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const filters: Array<[string, unknown]> = [];
  const supabase = {
    from(table: string) {
      const chain = {
        update(args: Record<string, unknown>) { calls.push({ name: "update", args }); return chain; },
        select() { return chain; },
        eq(key: string, value: unknown) { filters.push([key, value]); return chain; },
        order() { return chain; },
        maybeSingle: async () => ({ data: options.missing ? null : table === "quotes" ? quote : version, error: null }),
        then(resolve: (value: unknown) => unknown) {
          return Promise.resolve({ data: table === "quote_versions" ? [version] : [], error: null }).then(resolve);
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
    "@/lib/quotes/transition-result": {transitionFailure},
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
  const compiled = ts.transpileModule(readFileSync(new URL("./transitions.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const routeModule = { exports: {} as { transitionQuote: (req: Request, context: unknown, action: string) => Promise<Response> } };
  const nativeRequire = createRequire(import.meta.url);
  new Function("require", "module", "exports", compiled)(
    (name: string) => dependencies[name] ?? nativeRequire(name), routeModule, routeModule.exports
  );
  return { calls, filters, invoke: (method: string, body: unknown = input) => routeModule.exports.transitionQuote(
    new Request("http://a.local/api/quotes/" + ID, { method, ...(method === "GET" ? {} : { body: JSON.stringify(body) }) }),
    { params: Promise.resolve({ id: ID }) }, route
  ) };
}

describe("controlled transition HTTP", () => {
  for (const action of ["send", "accept", "reject"]) {
    it(`${action} binds host tenant before RPC and returns replay`, async () => {
      const h = harness(action, { rpcBody: { ok: true, replayed: true, version: { ...version, state: "sent" } } });
      const response = await h.invoke("POST");
      assert.equal(response.status, 200);
      assert.equal((await response.json()).replayed, true);
      assert.deepEqual(h.calls[0], { name: "transition_quote_v1", args: { p_quote_id: ID, p_version_id: VERSION, p_expected_row_version: 4, p_action: action } });
      assert.ok(h.filters.some(([k,v]) => k === "tenant_id" && v === "tenant-a"));
    });
    it(`${action} hides cross tenant and enforces guard`, async () => {
      for (const denied of [401,403,404]) {
        const h = harness(action, { denied }); assert.equal((await h.invoke("POST")).status, denied); assert.equal(h.calls.length,0);
      }
      const h = harness(action, { missing: true }); assert.equal((await h.invoke("POST")).status,404); assert.equal(h.calls.length,0);
    });
    it(`${action} validates version/token and domain errors`, async () => {
      for (const body of [{}, {version_id:VERSION,expected_row_version:-1}, {version_id:ID,expected_row_version:"4"}]) {
        assert.equal((await harness(action).invoke("POST",body)).status,422);
      }
      for (const [error,status] of [["conflict",409],["invalid_state",409],["pdf_required",422],["not_found",404]] as const) {
        const response=await harness(action,{rpcBody:{ok:false,error,row_version:9}}).invoke("POST");
        assert.equal(response.status,status);
      }
    });
  }
});
