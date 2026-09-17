import { NextResponse } from "next/server";
import { executeArchiveOrder } from "@/lib/orders/archive-api";
import { createClient } from "@/lib/supabase/server";
import { getCurrentContext } from "@/lib/tenant/current-context";

export async function PATCH(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const context = await getCurrentContext();
  const { id } = await params;

  if (!context) {
    return NextResponse.json(
      { error: "Unauthorized or tenant access denied" },
      { status: 403 }
    );
  }

  const supabase = await createClient();

  const result = await executeArchiveOrder({
    orderId: id,
    context,
    archiveOrder: async (args) => {
      const { data, error } = await supabase.rpc("archive_order", args);
      return { data, error };
    },
  });

  if (result.status >= 400) {
    console.error("[PATCH /api/orders/:id/archive] archive_order failed", {
      tenantId: context.tenant.id,
      userId: context.user.id,
      orderId: id,
      status: result.status,
      body: result.body,
    });
  }

  return NextResponse.json(result.body, { status: result.status });
}
