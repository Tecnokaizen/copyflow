import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentContext } from "@/lib/tenant/current-context";

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

  const { data: status, error: statusError } = await supabase
    .from("order_statuses")
    .select("id, tenant_id, code, name")
    .eq("id", status_id)
    .eq("tenant_id", context.tenant.id)
    .single();

  if (statusError || !status) {
    return NextResponse.json(
      { error: "Invalid order status" },
      { status: 400 }
    );
  }

  const { data: currentOrder, error: currentOrderError } = await supabase
    .from("orders")
    .select("id, ready_at, delivered_at")
    .eq("id", id)
    .eq("tenant_id", context.tenant.id)
    .single();

  if (currentOrderError || !currentOrder) {
    return NextResponse.json(
      {
        error: "Could not update order",
        detail: currentOrderError?.message ?? null,
      },
      { status: 500 }
    );
  }

  const now = new Date().toISOString();
  const updates: {
    status_id: string;
    updated_at: string;
    ready_at?: string;
    delivered_at?: string;
  } = {
    status_id: status.id,
    updated_at: now,
  };

  if (status.code === "ready" && !currentOrder.ready_at) {
    updates.ready_at = now;
  }

  if (status.code === "delivered" && !currentOrder.delivered_at) {
    updates.delivered_at = now;
  }

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .update(updates)
    .eq("id", id)
    .eq("tenant_id", context.tenant.id)
    .select("id, reference, status_id, ready_at, delivered_at")
    .single();

  if (orderError || !order) {
    return NextResponse.json(
      {
        error: "Could not update order",
        detail: orderError?.message ?? null,
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    tenant: context.tenant.slug,
    order,
    status,
  });
}