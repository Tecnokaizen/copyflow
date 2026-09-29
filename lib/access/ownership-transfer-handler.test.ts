import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runOwnershipTransfer } from "./ownership-transfer-handler";

const actor = "a3800000-0000-4000-8000-000000000001";
const target = "a3800000-0000-4000-8000-000000000002";
const tenant = "a3800000-0000-4000-8000-000000000011";

const owner = {
  actorUserId: actor,
  tenantId: tenant,
  role: "owner",
};

function successRpc() {
  const calls: Array<{ tenantId: string; targetUserId: string }> = [];
  return {
    calls,
    transfer: async (args: { tenantId: string; targetUserId: string }) => {
      calls.push(args);
      return {
        data: {
          ok: true,
          previous_owner: { user_id: actor, role: "admin", active: true },
          new_owner: { user_id: args.targetUserId, role: "owner", active: true },
        },
        error: null,
      };
    },
  };
}

describe("ownership transfer route behavior", () => {
  it("rejects a non-owner before calling the RPC", async () => {
    const rpc = successRpc();
    const result = await runOwnershipTransfer({
      context: { ...owner, role: "admin" },
      rawBody: JSON.stringify({ target_user_id: target }),
      transfer: rpc.transfer,
    });
    assert.equal(result.status, 403);
    assert.equal(rpc.calls.length, 0);
  });

  it("rejects an invalid payload", async () => {
    const rpc = successRpc();
    const invalid = await runOwnershipTransfer({
      context: owner,
      rawBody: "{",
      transfer: rpc.transfer,
    });
    const extra = await runOwnershipTransfer({
      context: owner,
      rawBody: JSON.stringify({ target_user_id: target, role: "owner" }),
      transfer: rpc.transfer,
    });
    assert.equal(invalid.status, 400);
    assert.equal(extra.status, 400);
    assert.equal(rpc.calls.length, 0);
  });

  it("calls the RPC for a valid owner", async () => {
    const rpc = successRpc();
    const result = await runOwnershipTransfer({
      context: owner,
      rawBody: JSON.stringify({ target_user_id: target }),
      transfer: rpc.transfer,
    });
    assert.equal(result.status, 200);
    assert.deepEqual(rpc.calls, [{ tenantId: tenant, targetUserId: target }]);
    assert.equal(
      (result.body.previous_owner as { role: string }).role,
      "admin"
    );
  });

  it("maps the organization owner limit to 409", async () => {
    const result = await runOwnershipTransfer({
      context: owner,
      rawBody: JSON.stringify({ target_user_id: target }),
      transfer: async () => ({
        data: null,
        error: { code: "54000", message: "organization limit reached" },
      }),
    });
    assert.equal(result.status, 409);
    assert.equal(result.body.error, "Conflict");
  });

  it("maps a denied RPC to 403 without SQL text", async () => {
    const result = await runOwnershipTransfer({
      context: owner,
      rawBody: JSON.stringify({ target_user_id: target }),
      transfer: async () => ({
        data: null,
        error: {
          code: "42501",
          message: "tenant access denied DETAIL: memberships row",
        },
      }),
    });
    assert.equal(result.status, 403);
    assert.equal(result.body.error, "Unauthorized or tenant access denied");
  });

  it("maps deadlock and serialization failure to a retry conflict", async () => {
    for (const code of ["40P01", "40001"]) {
      const result = await runOwnershipTransfer({
        context: owner,
        rawBody: JSON.stringify({ target_user_id: target }),
        transfer: async () => ({
          data: null,
          error: { code, message: `SQLSTATE ${code} deadlock detected` },
        }),
      });
      assert.equal(result.status, 409);
      assert.equal(result.body.error, "Conflict. Please retry.");
      assert.equal(String(result.body.error).includes("deadlock"), false);
    }
  });

  it("denies a replay once the actor is no longer owner", async () => {
    const rpc = successRpc();
    const first = await runOwnershipTransfer({
      context: owner,
      rawBody: JSON.stringify({ target_user_id: target }),
      transfer: rpc.transfer,
    });
    const replay = await runOwnershipTransfer({
      context: { ...owner, role: "admin" },
      rawBody: JSON.stringify({ target_user_id: target }),
      transfer: rpc.transfer,
    });
    assert.equal(first.status, 200);
    assert.equal(replay.status, 403);
    assert.equal(rpc.calls.length, 1);
  });
});
