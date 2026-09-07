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
    .from("service_categories")
    .select("id, name, active, sort_order")
    .eq("tenant_id", context.tenant.id)
    .eq("active", true)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  if (error) {
    console.error("load_service_categories", error.message);

    return NextResponse.json(
      { error: "Could not load categories" },
      { status: 500 }
    );
  }

  return NextResponse.json({
    tenant: context.tenant.slug,
    categories: data ?? [],
  });
}
