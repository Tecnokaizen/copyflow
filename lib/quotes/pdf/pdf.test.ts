import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PDFDocument } from "pdf-lib";
import { createHash } from "node:crypto";
import { anfreFixture } from "./fixture";
import { quoteDocumentModel, documentMoney, documentNumber, documentUnitPrice } from "./model";
import { renderQuotePdf } from "./render";
import { generateQuotePdf, type PdfHead, type PdfProvider } from "./generate";

describe("authoritative commercial PDF", () => {
  it("uses commercial revision labels in PDF metadata and hides the first revision", async () => {
    const f = anfreFixture();
    const first = quoteDocumentModel(f.reference, { ...f.version, version_number: 1 }, f.items);
    const second = quoteDocumentModel(f.reference, { ...f.version, version_number: 2 }, f.items);
    assert.equal((await PDFDocument.load(await renderQuotePdf(first))).getTitle(), `Presupuesto ${f.reference}`);
    assert.equal((await PDFDocument.load(await renderQuotePdf(second))).getTitle(), `Presupuesto ${f.reference} · Revisión 2`);
  });
  it("rejects draft and accepts prepared/sent only", () => {
    const f = anfreFixture();
    assert.throws(() => quoteDocumentModel(f.reference, { ...f.version, state: "draft" }, f.items), /version_not_prepared/);
    assert.equal(quoteDocumentModel(f.reference, { ...f.version, state: "sent" }, f.items).version.state, "sent");
  });
  it("reads snapshots, preserves authoritative fiscal amounts and omits internal data", () => {
    const f = anfreFixture(); const m = quoteDocumentModel(f.reference, f.version, f.items);
    assert.equal(m.client.contact, "Raquel Horcajo"); assert.equal(m.client.name, "ANFRE");
    assert.equal(m.version.total, "630.00"); assert.equal(m.version.subtotal, "520.66"); assert.equal(m.version.tax_total, "109.34");
    assert.equal(m.items[1].total, "303"); assert.equal(JSON.stringify(m).includes("INTERNAL_ONLY"), false);
    assert.equal(quoteDocumentModel(f.reference, { ...f.version, prices_include_tax: false, subtotal: "630", tax_total: "132.30", total: "762.30" }, f.items).version.total, "762.30");
  });
  it("formats exact DB decimal scales without rounding or insignificant zeros", () => {
    assert.equal(documentMoney("999999999999999999.99", "EUR"), "999.999.999.999.999.999,99 EUR");
    assert.equal(documentNumber("60.000000"), "60"); assert.equal(documentNumber("2.500000"), "2,5");
    assert.equal(documentNumber("21.000000"), "21"); assert.equal(documentUnitPrice("2.025000", "EUR"), "2,025 EUR");
  });
  it("renders a valid byte-deterministic PDF with embedded fonts", async () => {
    const f = anfreFixture(), m = quoteDocumentModel(f.reference, f.version, f.items);
    const a = await renderQuotePdf(m), b = await renderQuotePdf(m);
    assert.equal(a.subarray(0,5).toString(), "%PDF-"); assert.equal(Buffer.isBuffer(a), true);
    assert.deepEqual(a, b);
    await renderQuotePdf({ ...m, description: "A different document between retries" });
    assert.deepEqual(a, await renderQuotePdf(m)); assert.match(a.toString("latin1"), /FontFile2/);
  });
  it("embeds PNG logo bytes rather than a remote URL", async () => {
    const f = anfreFixture(), m = quoteDocumentModel(f.reference, f.version, f.items);
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7WQAAAAASUVORK5CYII=", "base64");
    const buffer = await renderQuotePdf(m, png);
    assert.match(buffer.toString("latin1"), /\/Subtype \/Image/);
  });
  it("supports 160 items across multiple pages", async () => {
    const f = anfreFixture(), m = quoteDocumentModel(f.reference, f.version, f.items);
    const buffer = await renderQuotePdf({ ...m, items: Array.from({length:160}, (_, i) => ({...m.items[i%4], id:`${i}`, position:i+1})) });
    assert.ok((buffer.toString("latin1").match(/\/Type \/Page\b/g) || []).length > 2);
  });
});
function fake() {
  let head: PdfHead = { exists:false,contentLength:null,contentType:null,etag:null,sha256:null };
  let linked = false, reserves = 0, puts = 0, finishes = 0, activities = 0;
  const buffer = Buffer.from("%PDF-test");
  const file = { id:"f", original_name:"q-v1.pdf",content_type:"application/pdf",size_bytes:buffer.length,status:"pending",completed_at:null };
  const provider: PdfProvider = {
    render:async()=>buffer,
    reserve:async()=>{reserves++;return { file: {...file,status:linked?"ready":"pending"}, storage_key:"quotes/a/q/f", upload_expires_at:new Date(Date.now()+3600000).toISOString(),linked };},
    head:async()=>head,
    putOnce:async(_key, body, sha256)=>{if (!head.exists) { puts++; head={exists:true,contentLength:body.length,contentType:"application/pdf",etag:"etag",sha256};}},
    finish:async()=>{finishes++;const replayed=linked;if(!linked) activities++;linked=true;return {file:{...file,status:"ready"},replayed};},
  };
  return { provider, stats:()=>({reserves,puts,finishes,activities,linked}), setHead:(value:PdfHead)=>{head=value;}, digest:createHash("sha256").update(buffer).digest("hex") };
}
describe("PDF partial failure and idempotency orchestration", () => {
  it("replays the same document without another PUT or activity", async () => {
    const f=fake();await generateQuotePdf(f.provider);assert.equal((await generateQuotePdf(f.provider)).replayed,true);
    assert.equal(f.stats().puts,1);assert.equal(f.stats().activities,1);
  });
  it("concurrent requests create one final object and activity", async () => {
    const f=fake(); const results=await Promise.all([generateQuotePdf(f.provider),generateQuotePdf(f.provider)]);
    assert.equal(results[0].file.id,results[1].file.id);assert.equal(f.stats().puts,1);assert.equal(f.stats().activities,1);
  });
  it("render failure creates no reservation", async()=>{
    const f=fake(); f.provider.render=async()=>{throw Error("render");};await assert.rejects(generateQuotePdf(f.provider));assert.equal(f.stats().reserves,0);
  });
  it("quota exceeded writes no object and links nothing",async()=>{
    const f=fake();f.provider.reserve=async()=>{throw Error("STORAGE_QUOTA_EXCEEDED");};await assert.rejects(generateQuotePdf(f.provider),/QUOTA/);assert.equal(f.stats().puts,0);assert.equal(f.stats().linked,false);
  });
  it("R2 failure does not finish; retry reuses the reservation",async()=>{
    const f=fake();const put=f.provider.putOnce;f.provider.putOnce=async()=>{throw Error("R2");};await assert.rejects(generateQuotePdf(f.provider),/R2/);
    assert.equal(f.stats().finishes,0);f.provider.putOnce=put;await generateQuotePdf(f.provider);assert.equal(f.stats().puts,1);
  });
  it("R2 written but DB unavailable retries HEAD without PUT",async()=>{
    const f=fake();const finish=f.provider.finish;f.provider.finish=async()=>{throw Error("DB");};await assert.rejects(generateQuotePdf(f.provider),/DB/);
    f.provider.finish=finish;await generateQuotePdf(f.provider);assert.equal(f.stats().puts,1);assert.equal(f.stats().activities,1);
  });
  it("ambiguous successful DB commit replays without duplicate activity",async()=>{
    const f=fake();const finish=f.provider.finish;f.provider.finish=async(id,etag)=>{await finish(id,etag);throw Error("timeout");};await assert.rejects(generateQuotePdf(f.provider),/timeout/);
    f.provider.finish=finish;assert.equal((await generateQuotePdf(f.provider)).replayed,true);assert.equal(f.stats().activities,1);
  });
  it("mismatched existing object cannot be linked or overwritten",async()=>{
    const f=fake();f.setHead({exists:true,contentLength:9,contentType:"application/pdf",etag:"x",sha256:"wrong"});
    await assert.rejects(generateQuotePdf(f.provider),/verificar/);assert.equal(f.stats().puts,0);assert.equal(f.stats().finishes,0);
  });
  it("expired reservations cannot be completed or revived",async()=>{
    const f=fake();const reserve=f.provider.reserve;f.provider.reserve=async(size)=>({...await reserve(size),upload_expires_at:"2000-01-01"});
    await assert.rejects(generateQuotePdf(f.provider),/expirada/);assert.equal(f.stats().puts,0);assert.equal(f.stats().finishes,0);
  });
});
