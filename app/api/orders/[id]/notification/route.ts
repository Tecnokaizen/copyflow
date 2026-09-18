import { NextRequest, NextResponse } from "next/server";
import { mapLifecycleRpcError } from "@/lib/orders/lifecycle-rpc-error";
import { createClient } from "@/lib/supabase/server";
import { getCurrentContext } from "@/lib/tenant/current-context";

const NOTIFICATION_STATUSES = [
  "not_notified",
  "notified",
  "notified_no_pickup",
] as const;

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const context = await getCurrentContext();

  if (!context) {
    return NextResponse.json(
      { error: "Unauthorized or tenant access denied" },
      { status: 403 }
    );
  }

  const { id } = await params;
  const body = await request.json();
  const { notification_status } = body;

  if (
    typeof notification_status !== "string" ||
    !NOTIFICATION_STATUSES.includes(
      notification_status as (typeof NOTIFICATION_STATUSES)[number]
    )
  ) {
    return NextResponse.json(
      { error: "Invalid notification_status" },
      { status: 400 }
    );
  }

  const supabase = await createClient();

  const { data, error } = await supabase.rpc(
    "change_order_notification_status",
    {
      p_order_id: id,
      p_notification_status: notification_status,
      p_tenant_id: context.tenant.id,
    }
  );

  if (error || !data) {
    console.error(
      "[PATCH /api/orders/:id/notification] change_order_notification_status failed",
      {
        tenantId: context.tenant.id,
        userId: context.user.id,
        orderId: id,
        code: error?.code,
        message: error?.message,
        details: error?.details,
        hint: error?.hint,
      }
    );

    const mapped = mapLifecycleRpcError(error, "Could not update customer notification status");

    return NextResponse.json(mapped.body, { status: mapped.status });
  }

  return NextResponse.json({
    ok: true,
    tenant: context.tenant.slug,
    order: data.order,
  });
}
