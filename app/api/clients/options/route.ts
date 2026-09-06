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

  const { data, error } = await supabase
    .from("customer_types")
    .select("id, name")
    .eq("tenant_id", context.tenant.id)
    .eq("active", true)
    .order("sort_order", { ascending: true });

  if (error) {
    return NextResponse.json(
      {
        error: "Could not load client options",
        detail: error.message,
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    tenant: context.tenant.slug,
    customer_types: data ?? [],
  });
}
