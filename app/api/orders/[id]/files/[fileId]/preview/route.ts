import { NextRequest, NextResponse } from "next/server";
import { runFilePreview } from "@/lib/files/preview";
import { createClient } from "@/lib/supabase/server";
import { getCurrentContext } from "@/lib/tenant/current-context";
import { presignGet } from "@/lib/storage/r2";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const NO_STORE = {
  "Cache-Control": "private, no-store, max-age=0, must-revalidate",
} as const;

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; fileId: string }> },
) {
  const context = await getCurrentContext();
  if (!context) {
    return NextResponse.json(
      { error: "Unauthorized or tenant access denied" },
      { status: 403, headers: NO_STORE },
    );
  }

  const { id: orderId, fileId } = await params;
  const idsValid = UUID_PATTERN.test(orderId) && UUID_PATTERN.test(fileId);
  const supabase = await createClient();

  let parentFound = false;
  if (idsValid) {
    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select("id")
      .eq("id", orderId)
      .eq("tenant_id", context.tenant.id)
      .maybeSingle();
    parentFound = !orderError && Boolean(order);
  }

  let file: {
    original_name: string;
    content_type: string | null;
    status: string;
    deleted_at: string | null;
    storage_key: string;
  } | null = null;

  if (idsValid && parentFound) {
    const { data, error } = await supabase
      .from("order_files")
      .select(
        "id, original_name, content_type, status, storage_key, deleted_at",
      )
      .eq("id", fileId)
      .eq("order_id", orderId)
      .eq("tenant_id", context.tenant.id)
      .maybeSingle();
    if (!error && data) {
      file = {
        original_name: String(data.original_name),
        content_type:
          typeof data.content_type === "string" ? data.content_type : null,
        status: String(data.status),
        deleted_at: data.deleted_at ? String(data.deleted_at) : null,
        storage_key: String(data.storage_key),
      };
    }
  }

  const result = await runFilePreview({
    idsValid,
    parentFound,
    parentMissingError: "Order not found",
    file,
    presign: (args) => presignGet(args),
  });

  return NextResponse.json(result.body, {
    status: result.status,
    headers: NO_STORE,
  });
}
