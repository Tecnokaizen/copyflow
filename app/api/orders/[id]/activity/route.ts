import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentContext } from "@/lib/tenant/current-context";

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

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("id, reference")
    .eq("id", id)
    .eq("tenant_id", context.tenant.id)
    .single();

  if (orderError || !order) {
    return NextResponse.json(
      { error: "Order not found" },
      { status: 404 }
    );
  }

  const { data: activity, error } = await supabase
    .from("activity_log")
    .select(
      "id, action, entity_type, entity_id, user_id, team_member_id, previous_values, new_values, metadata, created_at"
    )
    .eq("tenant_id", context.tenant.id)
    .eq("entity_type", "order")
    .eq("entity_id", id)
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json(
      {
        error: "Could not load order activity",
        detail: error.message,
      },
      { status: 500 }
    );
  }

  const rows = activity ?? [];

  return NextResponse.json({
    tenant: context.tenant.slug,
    order: {
      id: order.id,
      reference: order.reference,
    },
    count: rows.length,
    activity: rows,
  });
}
