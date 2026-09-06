import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentContext } from "@/lib/tenant/current-context";

function statusForRpcError(code: string | undefined) {
  switch (code) {
    case "28000":
      return 401;
    case "42501":
      return 403;
    case "22023":
      return 400;
    case "P0002":
      return 404;
    default:
      return 500;
  }
}

export async function GET(
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
  const supabase = await createClient();

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
      file_status:file_statuses(*),
      quote_status:quote_statuses(*),
      payment_status:payment_statuses(*),
      delivery_method:delivery_methods(*)
    `)
    .eq("id", id)
    .eq("tenant_id", context.tenant.id)
    .single();

  if (error || !order) {
    return NextResponse.json(
      { error: "Order not found" },
      { status: 404 }
    );
  }

  return NextResponse.json({
    tenant: context.tenant.slug,
    order,
  });
}

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
  const { status_id } = body;

  if (!status_id) {
    return NextResponse.json(
      { error: "status_id is required" },
      { status: 400 }
    );
  }

  const supabase = await createClient();

  const { data, error } = await supabase.rpc("change_order_status", {
    p_order_id: id,
    p_status_id: status_id,
    p_tenant_id: context.tenant.id,
  });

  if (error || !data) {
    return NextResponse.json(
      {
        error: "Could not update order",
        detail: error?.message ?? null,
      },
      { status: statusForRpcError(error?.code) }
    );
  }

  return NextResponse.json({
    ok: true,
    tenant: context.tenant.slug,
    order: data.order,
    status: data.status,
  });
}
