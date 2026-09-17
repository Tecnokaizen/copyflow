import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mapLifecycleRpcError } from "./lifecycle-rpc-error";

describe("mapLifecycleRpcError", () => {
  it("maps known archived conflict to 409 ORDER_ARCHIVED", () => {
    assert.deepEqual(
      mapLifecycleRpcError({
        code: "42501",
        message: "order is archived",
      }),
      {
        status: 409,
        body: {
          error: "Order is archived",
          code: "ORDER_ARCHIVED",
        },
      }
    );
  });

  it("maps known non-terminal conflict to 409 ORDER_NOT_TERMINAL", () => {
    assert.deepEqual(
      mapLifecycleRpcError({
        code: "42501",
        message: "order is not terminal",
      }),
      {
        status: 409,
        body: {
          error: "Order must be terminal before archiving",
          code: "ORDER_NOT_TERMINAL",
        },
      }
    );
  });

  it("keeps generic 42501 as 403 without lifecycle codes", () => {
    assert.deepEqual(
      mapLifecycleRpcError({
        code: "42501",
        message: "tenant access denied",
      }),
      {
        status: 403,
        body: { error: "Unauthorized or tenant access denied" },
      }
    );
  });

  it("maps base SQLSTATE codes without exposing raw SQL", () => {
    assert.deepEqual(mapLifecycleRpcError({ code: "28000", message: "not authenticated" }), {
      status: 401,
      body: { error: "Unauthorized" },
    });
    assert.deepEqual(mapLifecycleRpcError({ code: "22023", message: "invalid order status" }), {
      status: 400,
      body: { error: "Invalid request" },
    });
    assert.deepEqual(mapLifecycleRpcError({ code: "P0002", message: "order not found" }), {
      status: 404,
      body: { error: "Order not found" },
    });
    assert.deepEqual(mapLifecycleRpcError({ code: "XX000", message: "boom" }, "Could not archive order"), {
      status: 500,
      body: { error: "Could not archive order" },
    });
  });

  it("detects lifecycle messages from details/hint digests", () => {
    assert.equal(
      mapLifecycleRpcError({
        code: "42501",
        message: "permission denied",
        details: "order is archived",
      }).body.code,
      "ORDER_ARCHIVED"
    );
  });
});
