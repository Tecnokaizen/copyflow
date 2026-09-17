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
  tenantId: string
) {
  return {
    p_order_id: orderId,
    p_status_id: statusId,
    p_tenant_id: tenantId,
  };
}

export async function executeChangeOrderStatus(input: {
  orderId: string;
  statusId: string;
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

  const args = changeOrderStatusRpcArgs(
    input.orderId,
    input.statusId,
    input.context.tenant.id
  );
  const { data, error } = await input.changeOrderStatus(args);

  if (error || !data || data.order == null) {
    return mapLifecycleRpcError(error, "Could not update order");
  }

  return {
    status: 200,
    body: {
      ok: true,
      tenant: input.context.tenant.slug,
      order: data.order,
      status: data.status,
    },
  };
}
