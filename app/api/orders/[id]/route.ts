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
  // Explicit whitelist — never select star; DTO also strips internals.
  const { data: order, error } = await supabase
    .from("orders")
    .select(`
      id,
      reference,
      title,
      description,
      priority,
      due_at,
      received_at,
      ready_at,
      delivered_at,
      archived_at,
      customer_notification_status,
      customer_notified_at,
      customer_notified_by,
      notes,
      client_id,
      status_id,
      service_id,
      entry_channel_id,
      assigned_team_member_id,
      order_context_id,
      store_id,
      file_status_id,
      quote_status_id,
      payment_status_id,
      delivery_method_id,
      external_folder_url,
      row_version,
      client:clients(id, name, active),
      service:services(id, name, active),
      status:order_statuses(id, code, name, is_initial, is_ready, is_closed, is_cancelled, active),
      entry_channel:entry_channels(id, code, name, active),
      assigned_team_member:team_members(id, name, active),
      order_context:order_contexts(id, name, active),
      store:stores(id, name, active),
      file_status:file_statuses(id, code, name, active),
      quote_status:quote_statuses(id, code, name, active),
      payment_status:payment_statuses(id, code, name, active),
      delivery_method:delivery_methods(id, code, name, active)
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
