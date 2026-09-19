import { NextRequest, NextResponse } from "next/server";
import { contentDispositionAttachment } from "@/lib/files/access";
import { GET_PRESIGN_TTL_SECONDS } from "@/lib/files/validation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentContext } from "@/lib/tenant/current-context";
import { presignGet } from "@/lib/storage/r2";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; fileId: string }> }
) {
  const context = await getCurrentContext();
  if (!context) {
    return NextResponse.json(
      { error: "Unauthorized or tenant access denied" },
      { status: 403 }
    );
  }

  const { id: orderId, fileId } = await params;
  if (!UUID_PATTERN.test(orderId) || !UUID_PATTERN.test(fileId)) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  const supabase = await createClient();
  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("id")
    .eq("id", orderId)
    .eq("tenant_id", context.tenant.id)
    .maybeSingle();

  if (orderError || !order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  const { data: file, error: fileError } = await supabase
    .from("order_files")
    .select(
      "id, original_name, content_type, status, storage_key, deleted_at"
    )
    .eq("id", fileId)
    .eq("order_id", orderId)
    .eq("tenant_id", context.tenant.id)
    .maybeSingle();

  if (fileError || !file || file.deleted_at) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  if (file.status !== "ready") {
    return NextResponse.json(
      { error: "File not ready", code: "UPLOAD_INCOMPLETE" },
      { status: 409 }
    );
  }

  const expiresAt = new Date(Date.now() + GET_PRESIGN_TTL_SECONDS * 1000);
  let downloadUrl: string;
  try {
    downloadUrl = await presignGet({
      key: String(file.storage_key),
      expiresIn: GET_PRESIGN_TTL_SECONDS,
      responseContentDisposition: contentDispositionAttachment(
        String(file.original_name)
      ),
      responseContentType:
        typeof file.content_type === "string" ? file.content_type : null,
    });
  } catch (error) {
    console.error("[POST .../download] presign failed", {
      message: error instanceof Error ? error.message : "unknown",
    });
    return NextResponse.json(
      { error: "Could not create download URL" },
      { status: 500 }
    );
  }

  return NextResponse.json({
    download_url: downloadUrl,
    expires_at: expiresAt.toISOString(),
    filename: file.original_name,
    content_type: file.content_type,
  });
}
