import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import vm from "node:vm";
import { describe, it } from "node:test";
import ts from "typescript";
import { NextRequest } from "next/server";
import { collectionError } from "./collection";

const root = path.resolve(import.meta.dirname, "../..");
const orderId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const snapshot = { ok: true, total_amount: "120.00", paid_amount: "20.00", pending_amount: "100.00", collection_state: "partial", row_version: "9007199254740994", payments: [] };

// Run the real total handler; replace only authenticated context and DB boundaries.
function harness(rpcCode?: string) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const filename = path.join(root, "app/api/orders/[id]/total/route.ts");
  const realRequire = createRequire(filename);
  const exports = {};
  const compiled = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(compiled, { exports, require(id: string) {
    if (id === "@/lib/tenant/current-context") return { getCurrentContext: async () => ({ tenant: { id: "tenant-a" }, user: { id: "actor" }, membership: { role: "staff" } }) };
    if (id === "@/lib/orders/profile-names") return { loadProfileNames: async () => [] };
    if (id === "@/lib/supabase/server") return { createClient: async () => ({
      async rpc(name: string, args: Record<string, unknown>) {
        calls.push({ name, args });
        return { data: rpcCode ? { ok: false, error: rpcCode } : snapshot, error: null };
      },
    }) };
    return realRequire(id.startsWith("@/") ? path.join(root, id.slice(2)) : id);
  } }, { filename });
  const { PATCH } = exports as { PATCH: (request: NextRequest, context: { params: Promise<{ id: string }> }) => Promise<Response> };
  return { calls, patch: (body: unknown) => PATCH(new NextRequest(`http://localhost/api/orders/${orderId}/total`, {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  }), { params: Promise.resolve({ id: orderId }) }) };
}

describe("total route concurrency regression", () => {
  it("passes the refreshed opaque row_version and unchanged three-argument RPC contract", async () => {
    const h = harness();
    const response = await h.patch({ total_amount: "120,00", expected_version: "9007199254740993" });
    assert.equal(response.status, 200);
    assert.deepEqual(JSON.parse(JSON.stringify(h.calls)), [{ name: "set_order_total_amount", args: {
      p_order_id: orderId, p_total: "120.00", p_expected_row_version: "9007199254740993",
    } }]);
    assert.equal((await response.json()).row_version, snapshot.row_version);
    assert.match(response.headers.get("Cache-Control") ?? "", /no-store/);
  });

  it("identifies a real stale version with code conflict, without retrying RPC", async () => {
    const h = harness("conflict");
    const response = await h.patch({ total_amount: "120", expected_version: "1" });
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { code: "conflict", error: collectionError("conflict").error });
    assert.equal(h.calls.length, 1);
  });

  it("identifies a missing or malformed version before making any monetary write", async () => {
    for (const expected_version of [undefined, "", "1.5", 1]) {
      const h = harness();
      const response = await h.patch({ total_amount: "120", expected_version });
      assert.equal(response.status, 409);
      assert.equal((await response.json()).code, "conflict");
      assert.equal(h.calls.length, 0);
    }
  });

  for (const code of ["order_archived", "already_voided", "idempotency_mismatch", "total_below_paid", "forbidden"]) {
    it(`preserves ${code} without labeling it as a version conflict`, async () => {
      const h = harness(code);
      const response = await h.patch({ total_amount: "120", expected_version: "2" });
      assert.equal(response.status, collectionError(code).status);
      assert.deepEqual(await response.json(), { error: collectionError(code).error });
      assert.equal(h.calls.length, 1);
    });
  }
});
