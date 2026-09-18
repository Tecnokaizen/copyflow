import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  archiveOrderRpcArgs,
  executeArchiveOrder,
  mapArchiveOrderSuccess,
} from "./archive-api";
import { executeChangeOrderStatus } from "./change-status-api";

const TENANT_A = {
  id: "22222222-2222-4222-8222-222222222222",
  slug: "demo",
};
const TENANT_B = {
  id: "11111111-1111-4111-8111-111111111111",
  slug: "sur4",
};
const ORDER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const STATUS_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const staffContext = {
  tenant: TENANT_A,
  user: { id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" },
};

describe("archiveOrderRpcArgs", () => {
  it("A. always binds p_order_id and context tenant id only", () => {
    assert.deepEqual(archiveOrderRpcArgs(ORDER_ID, TENANT_A.id), {
      p_order_id: ORDER_ID,
      p_tenant_id: TENANT_A.id,
    });
  });
});

describe("executeArchiveOrder", () => {
  it("returns 403 without context", async () => {
    const result = await executeArchiveOrder({
      orderId: ORDER_ID,
      context: null,
      archiveOrder: async () => {
        throw new Error("rpc must not run");
      },
    });
    assert.equal(result.status, 403);
    assert.deepEqual(result.body, {
      error: "Unauthorized or tenant access denied",
    });
  });

  it("G. viewer/role denied stays 403 without lifecycle code", async () => {
    const result = await executeArchiveOrder({
      orderId: ORDER_ID,
      context: staffContext,
      archiveOrder: async () => ({
        data: null,
        error: { code: "42501", message: "tenant access denied" },
      }),
    });
    assert.equal(result.status, 403);
    assert.deepEqual(result.body, {
      error: "Unauthorized or tenant access denied",
    });
  });

  it("staff archive terminal is permitted", async () => {
    const calls: unknown[] = [];
    const order = { id: ORDER_ID, archived_at: "2026-09-17T12:00:00.000Z" };
    const result = await executeArchiveOrder({
      orderId: ORDER_ID,
      context: staffContext,
      archiveOrder: async (args) => {
        calls.push(args);
        return { data: { order, replay: false }, error: null };
      },
    });
    assert.deepEqual(calls, [
      { p_order_id: ORDER_ID, p_tenant_id: TENANT_A.id },
    ]);
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, {
      ok: true,
      tenant: "demo",
      order,
      replay: false,
    });
  });

  it("B. propagates replay=true as success", async () => {
    const order = { id: ORDER_ID, archived_at: "2026-09-17T12:00:00.000Z" };
    const result = await executeArchiveOrder({
      orderId: ORDER_ID,
      context: staffContext,
      archiveOrder: async () => ({
        data: { order, replay: true },
        error: null,
      }),
    });
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, mapArchiveOrderSuccess({ order, replay: true }, "demo"));
    assert.equal(
      (result.body as { replay: boolean }).replay,
      true
    );
  });

  it("archive non-terminal returns 409 ORDER_NOT_TERMINAL", async () => {
    const result = await executeArchiveOrder({
      orderId: ORDER_ID,
      context: staffContext,
      archiveOrder: async () => ({
        data: null,
        error: { code: "42501", message: "order is not terminal" },
      }),
    });
    assert.equal(result.status, 409);
    assert.deepEqual(result.body, {
      error: "Order must be terminal before archiving",
      code: "ORDER_NOT_TERMINAL",
    });
  });

  it("F. tenant isolation: RPC always receives context tenant, never payload tenant", async () => {
    const calls: Array<{ p_order_id: string; p_tenant_id: string }> = [];
    await executeArchiveOrder({
      orderId: ORDER_ID,
      context: { tenant: TENANT_A, user: staffContext.user },
      archiveOrder: async (args) => {
        calls.push(args);
        return {
          data: null,
          error: { code: "42501", message: "tenant access denied" },
        };
      },
    });
    assert.deepEqual(calls[0], {
      p_order_id: ORDER_ID,
      p_tenant_id: TENANT_A.id,
    });
    assert.notEqual(calls[0]?.p_tenant_id, TENANT_B.id);
  });

  it("order not found returns 404", async () => {
    const result = await executeArchiveOrder({
      orderId: ORDER_ID,
      context: staffContext,
      archiveOrder: async () => ({
        data: null,
        error: { code: "P0002", message: "order not found" },
      }),
    });
    assert.equal(result.status, 404);
    assert.deepEqual(result.body, { error: "Order not found" });
  });
});

describe("executeChangeOrderStatus archived", () => {
  it("E. archived status change returns 409 ORDER_ARCHIVED", async () => {
    const result = await executeChangeOrderStatus({
      orderId: ORDER_ID,
      statusId: STATUS_ID,
      expectedVersion: "0",
      context: staffContext,
      changeOrderStatus: async () => ({
        data: null,
        error: { code: "42501", message: "order is archived" },
      }),
    });
    assert.equal(result.status, 409);
    assert.deepEqual(result.body, {
      error: "Order is archived",
      code: "ORDER_ARCHIVED",
    });
  });

  it("uses server tenant id in change_order_status args", async () => {
    const calls: unknown[] = [];
    await executeChangeOrderStatus({
      orderId: ORDER_ID,
      statusId: STATUS_ID,
      expectedVersion: "0",
      context: staffContext,
      changeOrderStatus: async (args) => {
        calls.push(args);
        return {
          data: {
            order: { id: ORDER_ID },
            status: { id: STATUS_ID },
            version: "1",
          },
          error: null,
        };
      },
    });
    assert.deepEqual(calls[0], {
      p_order_id: ORDER_ID,
      p_status_id: STATUS_ID,
      p_tenant_id: TENANT_A.id,
      p_expected_version: "0",
    });
  });
});

describe("lifecycle API route security contracts", () => {
  const root = process.cwd();
  const archiveRoute = readFileSync(
    path.join(root, "app/api/orders/[id]/archive/route.ts"),
    "utf8"
  );
  const orderRoute = readFileSync(
    path.join(root, "app/api/orders/[id]/route.ts"),
    "utf8"
  );

  it("archive endpoint uses archive_order RPC and no direct UPDATE/service_role", () => {
    assert.match(archiveRoute, /rpc\(\s*["']archive_order["']/);
    assert.match(archiveRoute, /executeArchiveOrder/);
    assert.equal(archiveRoute.includes('.from("orders").update'), false);
    assert.equal(archiveRoute.includes("service_role"), false);
    assert.equal(archiveRoute.includes("SERVICE_ROLE"), false);
    assert.equal(archiveRoute.includes("request.json"), false);
    assert.equal(archiveRoute.includes("p_tenant_id:"), false);
  });

  it("D. GET order detail does not exclude archived rows", () => {
    assert.match(orderRoute, /export async function GET/);
    assert.equal(orderRoute.includes('.eq("archived_at"'), false);
    assert.equal(orderRoute.includes("archived_at, null"), false);
    assert.match(orderRoute, /\.eq\("tenant_id", context\.tenant\.id\)/);
  });

  it("PATCH status uses change_order_status RPC only and lifecycle mapping", () => {
    assert.match(orderRoute, /rpc\(\s*["']change_order_status_v2["']/);
    assert.match(orderRoute, /executeChangeOrderStatus|mapLifecycleRpcError/);
    assert.equal(orderRoute.includes('.from("orders").update'), false);
    assert.equal(orderRoute.includes("service_role"), false);
  });
});
