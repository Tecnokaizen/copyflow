import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { MEMBERSHIP_ROLES } from "@/lib/auth/membership-roles";
import { proEarlyAccessGate, resolveProEarlyAccess } from "./early-access-server";

type RpcResult = { data: unknown; error: unknown };

function fakeSupabase(result: RpcResult | Error) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const client = {
    async rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      if (result instanceof Error) {
        throw result;
      }
      return result;
    },
  };
  return { calls, client: client as unknown as SupabaseClient };
}

const context = (role: string) => ({
  user: { id: "user-a" },
  tenant: { id: "tenant-a", name: "A", slug: "a" },
  membership: { role, active: true },
});

describe("resolveProEarlyAccess", () => {
  it("asks the existing RPC for the session tenant and the program code only", async () => {
    const { calls, client } = fakeSupabase({ data: true, error: null });
    assert.equal(await resolveProEarlyAccess(client, "tenant-a"), true);
    assert.deepEqual(calls, [
      {
        name: "tenant_has_feature",
        args: { p_tenant_id: "tenant-a", p_code: "pro_early_access" },
      },
    ]);
  });

  it("fails closed on RPC errors, unexpected values and thrown exceptions", async () => {
    const failures: Array<RpcResult | Error> = [
      { data: false, error: null },
      { data: null, error: null },
      { data: "true", error: null },
      { data: true, error: { message: "permission denied", code: "42501" } },
      new Error("network down"),
    ];
    for (const failure of failures) {
      const { client } = fakeSupabase(failure);
      assert.equal(await resolveProEarlyAccess(client, "tenant-a"), false);
    }
  });
});

describe("proEarlyAccessGate", () => {
  it("allows every active role of an enrolled tenant", async () => {
    for (const role of MEMBERSHIP_ROLES) {
      const gate = await proEarlyAccessGate({
        getContext: async () => context(role),
        hasProEarlyAccess: async (tenantId) => tenantId === "tenant-a",
      });
      assert.equal(gate.ok, true, role);
    }
  });

  it("denies without context (no session, inactive tenant or membership) before resolving", async () => {
    let resolved = 0;
    const gate = await proEarlyAccessGate({
      getContext: async () => null,
      hasProEarlyAccess: async () => {
        resolved += 1;
        return true;
      },
    });
    assert.deepEqual(gate, { ok: false });
    assert.equal(resolved, 0);
  });

  it("denies when the tenant is not enrolled or the program was revoked", async () => {
    const gate = await proEarlyAccessGate({
      getContext: async () => context("owner"),
      hasProEarlyAccess: async () => false,
    });
    assert.deepEqual(gate, { ok: false });
  });

  it("denies on any thrown error and on an unknown role", async () => {
    const throwingContext = await proEarlyAccessGate({
      getContext: async () => {
        throw new Error("auth unavailable");
      },
      hasProEarlyAccess: async () => true,
    });
    const throwingFeature = await proEarlyAccessGate({
      getContext: async () => context("owner"),
      hasProEarlyAccess: async () => {
        throw new Error("rpc unavailable");
      },
    });
    const unknownRole = await proEarlyAccessGate({
      getContext: async () => context("superadmin"),
      hasProEarlyAccess: async () => true,
    });
    assert.deepEqual(throwingContext, { ok: false });
    assert.deepEqual(throwingFeature, { ok: false });
    assert.deepEqual(unknownRole, { ok: false });
  });
});
