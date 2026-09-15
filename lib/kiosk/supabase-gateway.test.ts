import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { KioskOrderInput } from "./payload";
import { createSupabaseKioskGateway } from "./supabase-gateway";

const capability = {
  tenantSlug: "demo",
  clientKey: "a".repeat(64),
  issuedAt: 1_789_000_000,
  purpose: "bootstrap" as const,
  binding: "bootstrap",
  signature: "b".repeat(64),
};

const input: KioskOrderInput = {
  submissionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  contact: { name: "Ana", email: "ana@example.com", phone: null },
  serviceId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  description: "Tarjetas",
  dueAt: null,
  observations: "Mate",
};

describe("createSupabaseKioskGateway", () => {
  it("calls only the signed bootstrap RPC", async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const gateway = createSupabaseKioskGateway({
      rpc: async (name: string, args: Record<string, unknown>) => {
        calls.push({ name, args });
        return { data: { status: "unavailable" }, error: null };
      },
    });
    await gateway.bootstrap(capability);
    assert.deepEqual(calls, [
      {
        name: "kiosk_bootstrap",
        args: {
          p_tenant_slug: "demo",
          p_client_key: "a".repeat(64),
          p_issued_at: 1_789_000_000,
          p_purpose: "bootstrap",
          p_binding: "bootstrap",
          p_signature: "b".repeat(64),
        },
      },
    ]);
  });

  it("calls the signed admission RPC before body parsing", async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const gateway = createSupabaseKioskGateway({
      rpc: async (name: string, args: Record<string, unknown>) => {
        calls.push({ name, args });
        return {
          data: {
            status: "admitted",
            permit: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          },
          error: null,
        };
      },
    });
    await gateway.admit({
      ...capability,
      purpose: "admit",
      binding: "request",
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].name, "admit_kiosk_request");
    assert.equal(calls[0].args.p_purpose, "admit");
    assert.equal(calls[0].args.p_binding, "request");
  });

  it("calls one transactional submit RPC with no tenant id", async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const gateway = createSupabaseKioskGateway({
      rpc: async (name: string, args: Record<string, unknown>) => {
        calls.push({ name, args });
        return { data: { status: "created", reference: "DEMO-0001" }, error: null };
      },
    });
    await gateway.submit(
      {
        ...capability,
        purpose: "submit",
        binding:
          "dddddddd-dddd-4ddd-8ddd-dddddddddddd|aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa|" +
          "f".repeat(64),
      },
      "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      input,
      "f".repeat(64),
      "Tarjetas"
    );
    assert.equal(calls.length, 1);
    assert.equal(calls[0].name, "submit_kiosk_order");
    assert.equal("p_tenant_id" in calls[0].args, false);
    assert.deepEqual(calls[0].args, {
      p_tenant_slug: "demo",
      p_client_key: "a".repeat(64),
      p_issued_at: 1_789_000_000,
      p_purpose: "submit",
      p_binding:
        "dddddddd-dddd-4ddd-8ddd-dddddddddddd|aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa|" +
        "f".repeat(64),
      p_signature: "b".repeat(64),
      p_permit_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      p_submission_id: input.submissionId,
      p_request_fingerprint: "f".repeat(64),
      p_title: "Tarjetas",
      p_service_id: input.serviceId,
      p_contact_name: "Ana",
      p_contact_email: "ana@example.com",
      p_contact_phone: null,
      p_description: "Tarjetas",
      p_due_at: null,
      p_observations: "Mate",
    });
  });

  it("propagates RPC errors without issuing fallback table queries", async () => {
    let calls = 0;
    const failure = Object.assign(new Error("permission denied"), {
      code: "42501",
    });
    const gateway = createSupabaseKioskGateway({
      rpc: async () => {
        calls += 1;
        return { data: null, error: failure };
      },
    });
    await assert.rejects(() => gateway.bootstrap(capability), failure);
    assert.equal(calls, 1);
  });
});
