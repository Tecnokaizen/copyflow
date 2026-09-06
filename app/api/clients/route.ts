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

  const { data: clients, error } = await supabase
    .from("clients")
    .select("*");

  if (error) {
    return NextResponse.json(
      {
        error: "Could not load clients",
        detail: error.message,
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    tenant: context.tenant.slug,
    count: clients.length,
    clients,
  });
}