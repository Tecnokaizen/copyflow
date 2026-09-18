import { NextRequest, NextResponse } from "next/server";
import { toPublicOrderDto } from "@/lib/orders/concurrency";
import { executeChangeOrderStatus } from "@/lib/orders/change-status-api";
import { operationalJson } from "@/lib/http/operational-cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentContext } from "@/lib/tenant/current-context";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const context = await getCurrentContext();

  if (!context) {
    return operationalJson(
      { error: "Unauthorized or tenant access denied" },
      { status: 403 }
    );
  }

  const { id } = await params;
  const supabase = await createClient();

  // Archived orders remain readable for authorized members.
  // Do not filter on archived_at — ficha must stay consultable.
  const { data: order, error } = await supabase
    .from("orders")
    .select(`
      *,
      client:clients(*),
      service:services(*),
      status:order_statuses(*),
      entry_channel:entry_channels(*),
      assigned_team_member:team_members(*),
      order_context:order_contexts(*),
      store:stores(*),
      file_status:file_statuses(*),
      quote_status:quote_statuses(*),
      payment_status:payment_statuses(*),
      delivery_method:delivery_methods(*)
    `)
    .eq("id", id)
    .eq("tenant_id", context.tenant.id)
    .single();

  if (error || !order) {
    return operationalJson(
      { error: "Order not found" },
      { status: 404 }
    );
  }

  return operationalJson({
    tenant: context.tenant.slug,
    order: toPublicOrderDto(order as Record<string, unknown>),
  });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const context = await getCurrentContext();
  const { id } = await params;
  const body = await request.json();
  const { status_id, expected_version } = body;
  const supabase = await createClient();

  const result = await executeChangeOrderStatus({
    orderId: id,
    statusId: typeof status_id === "string" ? status_id : "",
    expectedVersion: expected_version,
    context,
    changeOrderStatus: async (args) => {
      const { data, error } = await supabase.rpc("change_order_status_v2", args);
      return { data, error };
    },
  });

  if (result.status >= 400) {
    console.error("[PATCH /api/orders/:id] change_order_status_v2 failed", {
      tenantId: context?.tenant.id,
      userId: context?.user.id,
      orderId: id,
      status: result.status,
      body: result.body,
    });
  }

  return NextResponse.json(result.body, { status: result.status });
}
