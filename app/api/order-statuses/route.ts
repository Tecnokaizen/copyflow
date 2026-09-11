import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentContext } from "@/lib/tenant/current-context";

export async function GET() {
  const context = await getCurrentContext();

  if (!context) {
    return NextResponse.json(
      { error: "Unauthorized or tenant access denied" },
      { status: 403 }
    );
  }

  const supabase = await createClient();

  const { data: statuses, error } = await supabase
    .from("order_statuses")
    .select(
      "id, code, name, active, is_initial, is_ready, is_closed, is_cancelled, sort_order"
    )
    .eq("tenant_id", context.tenant.id)
    .order("sort_order", { ascending: true });

  if (error) {
    console.error("[GET /api/order-statuses] Could not load order statuses", {
      tenantId: context.tenant.id,
      error,
    });

    return NextResponse.json(
      { error: "Could not load order statuses" },
      { status: 500 }
    );
  }

  return NextResponse.json({
    tenant: context.tenant.slug,
    count: statuses.length,
    statuses,
  });
}
