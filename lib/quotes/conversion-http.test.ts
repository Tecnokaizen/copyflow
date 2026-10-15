import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, it } from "node:test";
import ts from "typescript";
import { parseQuoteConversion } from "./conversion";
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

function harness(route: string, options: { denied?: number; missing?: boolean; rpcBody?: unknown; rpcError?: { code: string; message: string } } = {}) {
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
      return { data: options.rpcBody ?? { ok: true, version }, error: options.rpcError ?? null };
    },
  };
  const json = (body: unknown, init?: ResponseInit) => Response.json(body, init);
  const dependencies: Record<string, unknown> = {
    "@/lib/quotes/conversion": {parseQuoteConversion},
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

const conversionInput = {store_id:null,service_id:null,assigned_team_member_id:null,priority:"normal",due_at:null,expected_row_version:4};
describe("accepted conversion HTTP",()=>{
  it("requires explicit fields and timezone-qualified delivery date",async()=>{
    for(const body of [{},{...conversionInput,store_id:"foreign"},{...conversionInput,expected_row_version:-1},{...conversionInput,priority:"bad"},{...conversionInput,due_at:"2026-10-06T10:30"}]) {
      assert.equal((await harness("convert").invoke("POST",body)).status,422);
    }
  });
  it("binds host before RPC and returns same replay order",async()=>{
    const h=harness("convert",{rpcBody:{ok:true,created:false,replayed:true,order_id:ID,reference:"O-0001"}});
    const response=await h.invoke("POST",{...conversionInput,tenant_id:"tenant-b",created_by:VERSION,accepted_version_id:VERSION,converted_order_id:VERSION});assert.equal(response.status,200);
    const result=await response.json();assert.equal(result.replayed,true);assert.equal(result.quote.converted_order_id,ID);
    assert.deepEqual(h.calls[0],{name:"convert_quote_to_order",args:{p_quote_id:ID,p_store_id:null,p_service_id:null,p_assigned_team_member_id:null,p_priority:"normal",p_due_at:null,p_expected_row_version:4}});
    assert.ok(h.filters.some(([key,value])=>key==="tenant_id"&&value==="tenant-a"));
  });
  it("gates viewer, feature, auth, cross tenant before conversion",async()=>{
    for(const denied of [401,403,404]) {const h=harness("convert",{denied});assert.equal((await h.invoke("POST",conversionInput)).status,denied);assert.equal(h.calls.length,0);}
    const h=harness("convert",{missing:true});assert.equal((await h.invoke("POST",conversionInput)).status,404);assert.equal(h.calls.length,0);
  });
  it("preserves database authorization failures",async()=>{
    const h=harness("convert",{rpcError:{code:"42501",message:"permission denied"}});
    const response=await h.invoke("POST",conversionInput);
    assert.equal(response.status,404);
    assert.equal((await response.json()).code,"not_found");
  });
  it("maps conflict and domain errors",async()=>{
    for(const [error,status] of [["conflict",409],["invalid_state",409],["invalid_relation",422],["no_initial_status",422],["not_found",404]] as const){
      assert.equal((await harness("convert",{rpcBody:{ok:false,error,row_version:8}}).invoke("POST",conversionInput)).status,status);
    }
  });
});
