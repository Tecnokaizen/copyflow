import {
  invalidExpectedVersionResponse,
  parseExpectedVersion,
  readReturnedVersion,
  rpcExpectedVersionArg,
} from "@/lib/orders/concurrency";
import { mapLifecycleRpcError } from "@/lib/orders/lifecycle-rpc-error";

export type ChangeOrderStatusContext = {
  tenant: { id: string; slug: string };
  user: { id: string };
};

export type ChangeOrderStatusRpcResult = {
  data:
    | {
        order?: unknown;
        status?: unknown;
        version?: unknown;
      }
    | null;
  error: {
    code?: string;
    message?: string;
    details?: string;
    hint?: string;
  } | null;
};

export function changeOrderStatusRpcArgs(
  orderId: string,
  statusId: string,
  tenantId: string,
  expectedVersion: string
) {
  return {
    p_order_id: orderId,
    p_status_id: statusId,
    p_tenant_id: tenantId,
    p_expected_version: rpcExpectedVersionArg(expectedVersion),
  };
}

export async function executeChangeOrderStatus(input: {
  orderId: string;
  statusId: string;
  expectedVersion: unknown;
  context: ChangeOrderStatusContext | null;
  changeOrderStatus: (
    args: ReturnType<typeof changeOrderStatusRpcArgs>
  ) => Promise<ChangeOrderStatusRpcResult>;
}): Promise<{ status: number; body: unknown }> {
  if (!input.context) {
    return {
      status: 403,
      body: { error: "Unauthorized or tenant access denied" },
    };
  }

  if (!input.statusId) {
    return {
      status: 400,
      body: { error: "status_id is required" },
    };
  }

  const invalidVersion = invalidExpectedVersionResponse(input.expectedVersion);
  if (invalidVersion) {
    return invalidVersion;
  }

  const expectedVersion = parseExpectedVersion(input.expectedVersion);
  if (!expectedVersion) {
    return {
      status: 422,
      body: { error: "expected_version is required" },
    };
  }

  const args = changeOrderStatusRpcArgs(
    input.orderId,
    input.statusId,
    input.context.tenant.id,
    expectedVersion
  );
  const { data, error } = await input.changeOrderStatus(args);

  if (error || !data || data.order == null) {
    return mapLifecycleRpcError(error, "Could not update order");
  }

  const version = readReturnedVersion(data);
  if (!version) {
    return mapLifecycleRpcError(error, "Could not update order");
  }

  return {
    status: 200,
    body: {
      ok: true,
      tenant: input.context.tenant.slug,
      order: data.order,
      status: data.status,
      version,
    },
  };
}
