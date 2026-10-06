import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, it } from "node:test";
import ts from "typescript";
import * as types from "./types";
import * as errors from "./errors";
import * as workflow from "./workflow";

function listHarness(terminalError = false) {
  const calls: Array<{ table: string; method: string; args: unknown[] }> = [];
  const terminalIds = ["accepted-id", "rejected-id"];
  const supabase = { from(table: string) {
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "eq", "order", "range", "in", "lt", "is", "not"])
      chain[method] = (...args: unknown[]) => { calls.push({ table, method, args }); return chain; };
    chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(table === "quote_statuses"
      ? { data: terminalIds.map((id) => ({ id })), error: terminalError ? { message: "failure" } : null }
      : { data: [], count: 0, error: null }).then(resolve);
    return chain;
  } };
  const json = (body: unknown, init?: ResponseInit) => Response.json(body, init);
  const deps: Record<string, unknown> = {
    "@/lib/quotes/guard": { requireQuotesAccess: async () => ({ ok: true, supabase, context: { tenant: { id: "tenant-a", slug: "a" } } }) },
    "@/lib/http/operational-cache": { operationalJson: json },
    "@/lib/quotes/errors": errors, "@/lib/quotes/payload": {}, "@/lib/quotes/relations": {},
    "@/lib/quotes/types": types, "@/lib/quotes/workflow": workflow,
  };
  const code = ts.transpileModule(readFileSync(new URL("../../app/api/quotes/route.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} as { GET: (request: unknown) => Promise<Response> } };
  const require = createRequire(import.meta.url);
  new Function("require", "module", "exports", code)((name: string) => deps[name] ?? require(name), mod, mod.exports);
  return { calls, invoke: () => mod.exports.GET({ nextUrl: new URL("http://a.local/api/quotes?status=expired&page=2") }) };
}
describe("expired quote date filter", () => {
  it("filters before pagination and excludes accepted, rejected and converted quotes, within the tenant", async () => {
    const h = listHarness(); assert.equal((await h.invoke()).status, 200);
    assert.ok(h.calls.some(c => c.table === "quotes" && c.method === "lt" && c.args[0] === "valid_until" && /^\d{4}-\d{2}-\d{2}$/.test(String(c.args[1]))));
    assert.ok(h.calls.some(c => c.table === "quotes" && c.method === "not" && c.args[2] === "(accepted-id,rejected-id)"));
    assert.ok(h.calls.some(c => c.table === "quotes" && c.method === "is" && c.args[0] === "converted_order_id"));
    assert.ok(h.calls.some(c => c.table === "quotes" && c.method === "range" && c.args[0] === 25));
    for (const table of ["quotes", "quote_statuses"]) assert.ok(h.calls.some(c => c.table === table && c.method === "eq" && c.args[0] === "tenant_id" && c.args[1] === "tenant-a"));
    assert.equal(h.calls.filter(c => c.method === "select").length, 2);
    assert.equal(h.calls.some(c => c.method === "eq" && c.args[1] === "expired"), false);
  });
  it("fails closed if the terminal catalog cannot be read", async () => {
    const h = listHarness(true); assert.equal((await h.invoke()).status, 500);
  });
});
