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

const { data: orders, error } = await supabase
  .from("orders")
  .select("*")
  .eq("tenant_id", context.tenant.id);

  if (error) {
    return NextResponse.json(
      {
        error: "Could not load orders",
        detail: error.message,
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    tenant: context.tenant.slug,
    count: orders.length,
    orders,
  });
}