import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import ts from "typescript";
import { commercialStatus } from "../quotes/creation";
import { printBranding } from "./order-document";
import { quotePrintModel } from "./quote-document";
import type { QuoteRecord } from "../quotes/types";
import type { QuotePrintLoad } from "./load-quote";

function harness(fields: Partial<QuoteRecord>, denied = false) {
  const calls: Array<{ table: string; method: string; args: unknown[] }> = [];
  const quote = { reference: "P0004", title: "Copias", status: { code: "draft", name: "Borrador" }, current_version_state: null, converted_order_id: null, client: null, service: null, assignee: null, internal_notes: "nota interna privada", ...fields };
  const supabase = { from(table: string) {
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "eq", "maybeSingle", "is", "order"]) chain[method] = (...args: unknown[]) => { calls.push({ table, method, args }); return chain; };
    chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: table === "quotes" ? quote : table === "tenant_settings" ? { business_name: "Demo", timezone: "Europe/Madrid" } : [], error: null }).then(resolve);
    return chain;
  } };
  const deps: Record<string, unknown> = {
    "server-only": {},
    react: { cache: (fn: unknown) => fn },
    "@/lib/print/order-document": { printBranding },
    "@/lib/print/quote-document": { quotePrintModel },
    "@/lib/quotes/creation": { commercialStatus },
    "@/lib/quotes/guard": { requireQuotesAccess: async () => denied ? { ok: false, response: { status: 403 } } : { ok: true, supabase, context: { tenant: { id: "tenant-a", name: "Demo" } } } },
    "@/lib/quotes/types": { QUOTE_SELECT: "current_version:quote_versions(state)", mapQuote: (value: unknown) => value },
    "@/lib/tenant/branding": { publicOrganizationIdentity: () => ({ display_name: "Demo", logo_url: null, branding: { brand_color: null } }) },
    "@/lib/time/zoned-day": { resolveTimeZone: () => "Europe/Madrid" },
    "@/lib/team/payload": { isUuid: () => true },
  };
  const code = ts.transpileModule(readFileSync(new URL("./load-quote.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} as { loadQuotePrint: (id: string) => Promise<QuotePrintLoad> } };
  new Function("require", "module", "exports", code)((name: string) => {
    if (!(name in deps)) throw new Error(`Unexpected dependency ${name}`);
    return deps[name];
  }, mod, mod.exports);
  return { calls, invoke: () => mod.exports.loadQuotePrint("ea460000-0000-4000-8000-000000000001") };
}

describe("quote control sheet uses the same current state as the editor", () => {
  const cases: Array<[Partial<QuoteRecord>, string]> = [
    [{ current_version_state: "prepared" }, "Preparado"],
    [{ current_version_state: "sent" }, "Enviado"],
    [{ current_version_state: "prepared", status: { id: "s", code: "accepted", name: "Aceptado", color: null } }, "Aceptado"],
    [{ current_version_state: "sent", converted_order_id: "order-1" }, "Convertido en pedido"],
    [{ current_version_state: null }, "Borrador"],
  ];
  for (const [fields, expected] of cases) it(`prints ${expected} without changing state or disclosing notes`, async () => {
    const h = harness(fields); const result = await h.invoke(); assert.equal(result.status, "ok");
    if (result.status !== "ok") return;
    assert.equal(result.model.details.find(f => f.label === "Estado")?.value, expected);
    assert.equal(JSON.stringify(result.model).includes("nota interna privada"), false);
    for (const table of ["quotes", "quote_files", "tenant_settings"]) assert.ok(h.calls.some(c => c.table === table && c.method === "eq" && c.args[0] === "tenant_id" && c.args[1] === "tenant-a"));
    assert.equal(h.calls.some(c => ["insert", "update", "rpc"].includes(c.method)), false);
  });
  it("denies access before reading the quote", async () => {
    const h = harness({}, true); assert.equal((await h.invoke()).status, "denied"); assert.equal(h.calls.length, 0);
  });
});
