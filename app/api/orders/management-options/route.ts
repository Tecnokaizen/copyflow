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
  const tenantId = context.tenant.id;

  const [
    fileStatusesResult,
    quoteStatusesResult,
    paymentStatusesResult,
    deliveryMethodsResult,
  ] = await Promise.all([
    supabase
      .from("file_statuses")
      .select("id, code, name")
      .eq("tenant_id", tenantId)
      .eq("active", true)
      .order("sort_order", { ascending: true }),
    supabase
      .from("quote_statuses")
      .select("id, code, name")
      .eq("tenant_id", tenantId)
      .eq("active", true)
      .order("sort_order", { ascending: true }),
    supabase
      .from("payment_statuses")
      .select("id, code, name")
      .eq("tenant_id", tenantId)
      .eq("active", true)
      .order("sort_order", { ascending: true }),
    supabase
      .from("delivery_methods")
      .select("id, code, name")
      .eq("tenant_id", tenantId)
      .eq("active", true)
      .order("sort_order", { ascending: true }),
  ]);

  const firstError =
    fileStatusesResult.error ??
    quoteStatusesResult.error ??
    paymentStatusesResult.error ??
    deliveryMethodsResult.error;

  if (firstError) {
    return NextResponse.json(
      {
        error: "Could not load management options",
        detail: firstError.message,
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    tenant: context.tenant.slug,
    file_statuses: fileStatusesResult.data ?? [],
    quote_statuses: quoteStatusesResult.data ?? [],
    payment_statuses: paymentStatusesResult.data ?? [],
    delivery_methods: deliveryMethodsResult.data ?? [],
  });
}
