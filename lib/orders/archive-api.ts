import { mapLifecycleRpcError } from "@/lib/orders/lifecycle-rpc-error";

export type ArchiveOrderContext = {
  tenant: { id: string; slug: string };
  user: { id: string };
};

export type ArchiveOrderRpcResult = {
  data:
    | {
        order?: unknown;
        replay?: boolean;
      }
    | null;
  error: {
    code?: string;
    message?: string;
    details?: string;
    hint?: string;
  } | null;
};

export function archiveOrderRpcArgs(orderId: string, tenantId: string) {
  return {
    p_order_id: orderId,
    p_tenant_id: tenantId,
  };
}

export function mapArchiveOrderSuccess(
  data: { order: unknown; replay?: boolean },
  tenantSlug: string
) {
  return {
    ok: true as const,
    tenant: tenantSlug,
    order: data.order,
    replay: data.replay === true,
  };
}

/**
 * Pure archive API decision: context + RPC only.
 * Never accepts tenant_id from the client payload.
 */
export async function executeArchiveOrder(input: {
  orderId: string;
  context: ArchiveOrderContext | null;
  archiveOrder: (
    args: ReturnType<typeof archiveOrderRpcArgs>
  ) => Promise<ArchiveOrderRpcResult>;
}): Promise<{ status: number; body: unknown }> {
  if (!input.context) {
    return {
      status: 403,
      body: { error: "Unauthorized or tenant access denied" },
    };
  }

  const args = archiveOrderRpcArgs(
    input.orderId,
    input.context.tenant.id
  );
  const { data, error } = await input.archiveOrder(args);

  if (error || !data || data.order == null) {
    return mapLifecycleRpcError(error, "Could not archive order");
  }

  return {
    status: 200,
    body: mapArchiveOrderSuccess(
      {
        order: data.order,
        replay: data.replay,
      },
      input.context.tenant.slug
    ),
  };
}
