/** Exercises the actual AWS/R2 helpers against a local S3 HTTP double. No cloud credentials or R2 Production. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import ts from "typescript";
const objects = new Map(); let writes = 0;
const server = createServer(async (req, res) => {
  const key = req.url.split("?")[0]; const existing = objects.get(key);
  if (req.method === "PUT") {
    if (existing && req.headers["if-none-match"] === "*") { res.writeHead(412); res.end(); return; }
    const chunks = []; for await (const c of req) chunks.push(c); const body = Buffer.concat(chunks);
    objects.set(key, { body, sha: req.headers["x-amz-meta-sha256"], mime: req.headers["content-type"] }); writes++;
    res.setHeader("ETag", '"local-etag"'); res.end();
  } else if (req.method === "HEAD") {
    if (!existing) { res.writeHead(404); res.end(); return; }
    res.setHeader("Content-Length", existing.body.length); res.setHeader("Content-Type", existing.mime);
    res.setHeader("ETag", '"local-etag"'); res.setHeader("x-amz-meta-sha256", existing.sha); res.end();
  } else { res.writeHead(405);res.end(); }
});
await new Promise(r=>server.listen(0,"127.0.0.1",r));
Object.assign(process.env, { R2_ENDPOINT:`http://127.0.0.1:${server.address().port}`, R2_ACCOUNT_ID:"local-test",
  R2_BUCKET_NAME:"private-test", R2_ACCESS_KEY_ID:"local-test", R2_SECRET_ACCESS_KEY:"local-test-secret" });
const compiled = ts.transpileModule(readFileSync("lib/storage/r2.ts","utf8"), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const mod={exports:{}}; const require=createRequire(import.meta.url);
new Function("require","module","exports",compiled)(name=>name==="server-only"?{}:require(name),mod,mod.exports);
const { putDocumentOnce, headDocument }=mod.exports;
try {
  const body=Buffer.from("%PDF-local-provider-test"), sha256=createHash("sha256").update(body).digest("hex"), key="quotes/tenant/quote/file";
  assert.equal((await headDocument({key})).exists,false);
  await Promise.all([putDocumentOnce({key,body,sha256}),putDocumentOnce({key,body,sha256})]);
  assert.equal(writes,1);
  const head=await headDocument({key});assert.equal(head.sha256,sha256);assert.equal(head.contentLength,body.length);assert.equal(head.contentType,"application/pdf");
  await putDocumentOnce({key,body:Buffer.from("replacement"),sha256:"wrong"});assert.equal(writes,1);assert.equal((await headDocument({key})).sha256,sha256);
  console.log(JSON.stringify({status:"PASS",assertions:7,provider:"local S3 HTTP double",objectWrites:writes,productionAccess:false}));
} finally {await new Promise(r=>server.close(r));}
