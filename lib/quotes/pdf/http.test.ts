import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import ts from "typescript";
import { QuotePdfError } from "./generate";
import { isUuid } from "../../team/payload";
const Q="11111111-1111-4111-8111-111111111111", V="22222222-2222-4222-8222-222222222222";
function compile(path: string, deps: Record<string, unknown>) {
  const js=ts.transpileModule(readFileSync(new URL(path,import.meta.url),"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const mod={exports:{} as Record<string,(...args: unknown[])=>Promise<unknown>>};
  new Function("require","module","exports",js)((name:string)=>{
    if (name in deps) return deps[name]; throw Error(`Unexpected dependency ${name}`);
  },mod,mod.exports);return mod.exports;
}
function route(options:{denied?:number;failure?:QuotePdfError;file?:boolean}={}) {
  let generations=0,signs=0; const bindings: unknown[]=[];
  const handlers=compile("../../../app/api/quotes/[id]/versions/[versionId]/pdf/route.ts",{
    "@/lib/quotes/guard":{requireQuotesAccess:async()=>options.denied?{ok:false,response:Response.json({error:"Denied"},{status:options.denied})}:{ok:true,supabase:{},context:{tenant:{id:"tenant-a"},user:{id:"u"}}}},
    "@/lib/http/operational-cache":{operationalJson:(body:unknown,init?:ResponseInit)=>Response.json(body,init)},
    "@/lib/team/payload":{isUuid}, "@/lib/quotes/pdf/generate":{QuotePdfError},
    "@/lib/files/access":{contentDispositionAttachment:()=>"attachment"},
    "@/lib/files/validation":{GET_PRESIGN_TTL_SECONDS:120},
    "@/lib/storage/r2":{presignGet:async(args:unknown)=>{signs++;bindings.push(args);return "https://private.test/signed-temporary";}},
    "@/lib/quotes/pdf/server":{
      preparePdfDocument:async(args:unknown)=>{generations++;bindings.push(args);if(options.failure)throw options.failure;return {file:{id:"f"},replayed:true};},
      loadPdfVersion:async(...args:unknown[])=>{bindings.push(args);if(options.failure)throw options.failure;return {version:{pdf_file_id:options.file===false?null:"f"}};},
      officialPdfFile:async(...args:unknown[])=>{bindings.push(args);return {storage_key:"quotes/a/q/f",original_name:"q.pdf"};},
    },
  });
  return {call:async(method:string,q=Q,v=V,download=false)=>await handlers[method](
    {nextUrl:new URL(`https://a.local/api?download=${download?1:0}`)}, {params:Promise.resolve({id:q,versionId:v})}) as Response,
    stats:()=>({generations,signs,bindings})};
}
describe("secure PDF HTTP entry points",()=>{
  it("returns unauthenticated/viewer/feature-off before any provider access",async()=>{
    for(const denied of [401,403,404])for(const method of ["GET","POST"]){const h=route({denied});assert.equal((await h.call(method)).status,denied);assert.equal(h.stats().generations+h.stats().signs,0);}
  });
  it("rejects malformed IDs",async()=>{const h=route();assert.equal((await h.call("POST","bad")).status,404);assert.equal((await h.call("GET",Q,"bad")).status,404);assert.equal(h.stats().bindings.length,0);});
  it("binds generation to host tenant and version, ignoring client payload",async()=>{const h=route();const r=await h.call("POST");assert.equal(r.status,200);const body=await r.json();assert.equal(body.replayed,true);assert.equal(body.preview_endpoint,`/api/quotes/${Q}/versions/${V}/pdf`);assert.equal(JSON.stringify(body).includes("storage_key"),false);assert.deepEqual(h.stats().bindings[0],{db:{},tenantId:"tenant-a",userId:"u",quoteId:Q,versionId:V});});
  it("rejects draft and cross-tenant not-found without signed URLs",async()=>{for(const failure of [new QuotePdfError("VERSION_NOT_PREPARED","Prepare",409),new QuotePdfError("NOT_FOUND","Missing",404)]){const h=route({failure});assert.equal((await h.call("POST")).status,failure.status);assert.equal((await h.call("GET")).status,failure.status);assert.equal(h.stats().signs,0);}});
  it("does not generate on GET for a version with no PDF",async()=>{const h=route({file:false});assert.equal((await h.call("GET")).status,404);assert.equal(h.stats().generations+h.stats().signs,0);});
  it("preview/download sign only the linked official file with a short TTL",async()=>{for(const download of [false,true]){const h=route();const r=await h.call("GET",Q,V,download);assert.equal(r.status,307);assert.equal(r.headers.get("Cache-Control"),"private, no-store");assert.deepEqual(h.stats().bindings[1],[{},"tenant-a",Q,V,"f"]);assert.deepEqual(h.stats().bindings[2],{key:"quotes/a/q/f",expiresIn:120,responseContentType:"application/pdf",responseContentDisposition:download?"attachment":"inline"});}});
  it("returns quota and provider errors without sensitive details",async()=>{const h=route({failure:new QuotePdfError("STORAGE_QUOTA_EXCEEDED","Cuota agotada",409)});assert.equal((await h.call("POST")).status,409);});
});
