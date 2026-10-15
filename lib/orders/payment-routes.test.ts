import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import vm from "node:vm";
import { describe, it } from "node:test";
import ts from "typescript";
import { NextRequest } from "next/server";
import { parsePaymentPayload } from "./payment-payload";
import { mapOrderCollection } from "./collection";
import { toPublicOrderFileDto } from "../files/dto";

const root = path.resolve(import.meta.dirname, "../..");
const tenant = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const order = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const file = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const valid = { amount: "10,50", paid_at: "2026-10-13T10:30:00Z", idempotency_key: "payment-test-key", payment_method: "bizum", receipt_file_id: file };
const snapshot = { ok: true, total_amount: "100.00", paid_amount: "10.50", pending_amount: "89.50", collection_state: "partial", row_version: "3", payments: [{ id: "payment", amount: "10.50", paid_at: valid.paid_at, payment_method: "bizum", receipt: { id: file, original_name: "bizum.pdf", storage_key: "never-expose" } }] };

function harness({ authenticated = true, ownOrder = true, rpcError = null as null | string, blobFails = false, fileReady = true } = {}) {
  const calls: Array<{ name: string; args?: Record<string, unknown> }> = [];
  const db = {
    from(table: string) {
      const filters: Record<string, unknown> = {};
      const query = {
        select: () => query,
        eq(key: string, value: unknown) { filters[key] = value; return query; },
        maybeSingle: async () => {
          if (table === "orders") {
            assert.equal(filters.tenant_id, tenant);
            return { data: ownOrder ? { id: order, archived_at: null } : null, error: null };
          }
          assert.equal(filters.tenant_id, tenant);
          assert.equal(filters.order_id, order);
          return { data: { id: file, storage_key: `orders/${tenant}/${order}/${file}`, original_name: "bizum.pdf", content_type: "application/pdf", status: fileReady ? "ready" : "pending", deleted_at: null }, error: null };
        },
      };
      return query;
    },
    async rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      if (name === "soft_delete_order_file") return rpcError
        ? { data: null, error: { code: "55000", message: rpcError } }
        : { data: { id: file, storage_deletion_id: "deletion-1" }, error: null };
      return { data: rpcError ? { ok: false, error: rpcError } : snapshot, error: null };
    },
  };
  function load(relative: string) {
    const filename = path.join(root, relative);
    const exports = {};
    const realRequire = createRequire(filename);
    const compiled = ts.transpileModule(readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    vm.runInNewContext(compiled, { exports, console, require(id: string) {
      if (id === "@/lib/tenant/current-context") return { getCurrentContext: async () => authenticated ? { tenant: { id: tenant }, user: { id: "actor" }, membership: { role: "staff" } } : null };
      if (id === "@/lib/supabase/server") return { createClient: async () => db };
      if (id === "@/lib/orders/profile-names") return { loadProfileNames: async () => [] };
      if (id === "@/lib/files/capability") return { requireFilesSigningSecret: () => "test-only", filesCapabilityIssuedAtNow: () => 1, createFilesCapability: () => ({ issuedAt: 1, signature: "test-signature" }) };
      // Outbox (#96): the route only asks for an inline attempt; failures stay queued for the cron.
      if (id === "@/lib/files/storage-deletion-server") return {
        finalizeUserFileDeletion: async (deletionId: string | null) => {
          calls.push({ name: "R2_FINALIZE", args: { deletionId } });
          if (blobFails) return; // logged and left pending; never surfaced as a failed delete
        },
      };
      if (id === "@/lib/storage/r2") return {
        deleteObject: async () => { calls.push({ name: "R2_DELETE" }); if (blobFails) throw new Error("blob down"); },
        presignGet: async () => { calls.push({ name: "R2_DOWNLOAD" }); return "https://r2.example/short-lived"; },
      };
      return realRequire(id.startsWith("@/") ? path.join(root, id.slice(2)) : id);
    } }, { filename });
    return exports as Record<string, (...args: unknown[]) => Promise<Response>>;
  }
  return { calls, load };
}
const context = { params: Promise.resolve({ id: order, fileId: file }) };
const request = (body: unknown) => new NextRequest("http://localhost/api/orders/test/payments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const paymentRoute = "app/api/orders/[id]/payments/route.ts";
const deleteRoute = "app/api/orders/[id]/files/[fileId]/route.ts";

describe("payment methods and real API handlers", () => {
  it("requires one of five methods, canonical money, a valid file ID and a timestamp with zone", () => {
    assert.equal(parsePaymentPayload(valid)?.amount, "10.50");
    for (const method of ["cash", "card", "bizum", "transfer", "other"]) assert.equal(parsePaymentPayload({ ...valid, payment_method: method, receipt_file_id: null })?.payment_method, method);
    for (const patch of [{ payment_method: null }, { payment_method: "crypto" }, { receipt_file_id: "other/key" }, { paid_at: "invalid" }, { paid_at: "2026-10-13T10:30" }, { amount: "0" }, { amount: "1.999" }]) assert.equal(parsePaymentPayload({ ...valid, ...patch }), null);
  });
  it("rejects invalid payload before RPC", async () => {
    const h = harness();
    const response = await h.load(paymentRoute).POST(request({ ...valid, payment_method: "" }), context);
    assert.equal(response.status, 422); assert.equal(h.calls.length, 0);
  });
  it("binds context tenant and exact payment data, ignores a forged tenant", async () => {
    const h = harness();
    const response = await h.load(paymentRoute).POST(request({ ...valid, tenant_id: "forged" }), context);
    assert.equal(response.status, 200);
    assert.deepEqual(JSON.parse(JSON.stringify(h.calls[0].args)), { p_order_id: order, p_amount: "10.50", p_paid_at: valid.paid_at, p_idempotency_key: valid.idempotency_key, p_payment_method: "bizum", p_receipt_file_id: file, p_tenant_id: tenant });
    assert.equal(JSON.stringify(await response.json()).includes("never-expose"), false);
  });
  it("rejects unauthenticated and foreign-context requests before RPC on GET and POST", async () => {
    for (const settings of [{ authenticated: false }, { ownOrder: false }]) {
      const h = harness(settings); const route = h.load(paymentRoute);
      assert.equal((await route.POST(request(valid), context)).status, settings.authenticated === false ? 403 : 404);
      assert.equal((await route.GET(request(valid), context)).status, settings.authenticated === false ? 403 : 404);
      assert.equal(h.calls.length, 0);
    }
  });
  it("preserves backend denial/conflict codes, no automatic retry", async () => {
    for (const [code, status] of [["forbidden", 403], ["idempotency_mismatch", 409], ["receipt_already_used", 409], ["invalid_receipt", 422], ["invalid_payment_method", 422]] as const) {
      const h = harness({ rpcError: code });
      assert.equal((await h.load(paymentRoute).POST(request(valid), context)).status, status);
      assert.equal(h.calls.length, 1);
    }
  });
  it("historical DTOs stay readable; receipt DTO never includes storage metadata", () => {
    const historic = mapOrderCollection({ ...snapshot, payments: [{ id: "old", amount: "1.00", paid_at: valid.paid_at }] });
    assert.equal(historic?.payments[0].payment_method, null);
    assert.equal(historic?.payments[0].receipt, null);
    assert.deepEqual(mapOrderCollection(snapshot)?.payments[0].receipt, { id: file, original_name: "bizum.pdf" });
    assert.equal(toPublicOrderFileDto({ id: file, payment_receipts: [{ id: "payment" }] }).protected_document, true);
    assert.equal(toPublicOrderFileDto({ id: file, payment_receipts: { id: "payment" } }).protected_document, true);
    assert.equal(toPublicOrderFileDto({ id: file, payment_receipts: null }).protected_document, undefined);
  });
  it("protects a receipt before any storage deletion; R2 failures stay queued (outbox)", async () => {
    const protectedFile = harness({ rpcError: "payment_receipt_protected" });
    assert.equal((await protectedFile.load(deleteRoute).DELETE(request({}), context)).status, 409);
    assert.deepEqual(protectedFile.calls.map(call => call.name), ["soft_delete_order_file"]);
    const failedBlob = harness({ blobFails: true });
    assert.equal((await failedBlob.load(deleteRoute).DELETE(request({}), context)).status, 204);
    assert.deepEqual(failedBlob.calls.map(call => call.name), ["soft_delete_order_file", "R2_FINALIZE"]);
    assert.deepEqual(failedBlob.calls[1].args, { deletionId: "deletion-1" });
    assert.equal(failedBlob.calls.some(call => call.name === "R2_DELETE"), false, "the route never deletes R2 directly");
  });
  it("secure download checks current tenant/order and ready file before signing", async () => {
    const relative = "app/api/orders/[id]/files/[fileId]/download/route.ts";
    const h = harness();
    assert.equal((await h.load(relative).POST(request({}), context)).status, 200);
    assert.deepEqual(h.calls.map(call => call.name), ["R2_DOWNLOAD"]);
    for (const settings of [{ ownOrder: false }, { fileReady: false }]) {
      const denied = harness(settings);
      assert.equal((await denied.load(relative).POST(request({}), context)).status, settings.ownOrder === false ? 404 : 409);
      assert.equal(denied.calls.length, 0);
    }
  });
});
