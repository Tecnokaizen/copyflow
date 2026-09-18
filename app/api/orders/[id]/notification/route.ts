import { NextRequest, NextResponse } from "next/server";
import {
  invalidExpectedVersionResponse,
  parseExpectedVersion,
  readReturnedVersion,
  rpcExpectedVersionArg,
} from "@/lib/orders/concurrency";
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
  const { notification_status, expected_version } = body;
  const invalidVersion = invalidExpectedVersionResponse(expected_version);
  if (invalidVersion) {
    return NextResponse.json(invalidVersion.body, { status: invalidVersion.status });
  }
  const expectedVersion = parseExpectedVersion(expected_version);
  if (!expectedVersion) {
    return NextResponse.json(
      { error: "expected_version is required" },
      { status: 422 }
    );
  }

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
    "change_order_notification_status_v2",
    {
      p_order_id: id,
      p_notification_status: notification_status,
      p_tenant_id: context.tenant.id,
      p_expected_version: rpcExpectedVersionArg(expectedVersion),
    }
  );

  if (error || !data) {
    console.error(
      "[PATCH /api/orders/:id/notification] change_order_notification_status_v2 failed",
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

  const version = readReturnedVersion(data);
  if (!version) {
    return NextResponse.json(
      mapLifecycleRpcError(null, "Could not update customer notification status").body,
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    tenant: context.tenant.slug,
    order: data.order,
    version,
  });
}
