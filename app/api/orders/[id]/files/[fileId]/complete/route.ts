import { NextRequest, NextResponse } from "next/server";
import { assertCanMutateOrderFiles } from "@/lib/files/access";
import {
  createFilesCapability,
  filesCapabilityIssuedAtNow,
  requireFilesSigningSecret,
} from "@/lib/files/capability";
import { toPublicOrderFileDto } from "@/lib/files/dto";
import { mapOrderFileRpcError } from "@/lib/files/rpc-error";
import { createClient } from "@/lib/supabase/server";
import { getCurrentContext } from "@/lib/tenant/current-context";
import { headObject } from "@/lib/storage/r2";

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
    .select("id, archived_at")
    .eq("id", orderId)
    .eq("tenant_id", context.tenant.id)
    .maybeSingle();

  if (orderError || !order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  const mutate = assertCanMutateOrderFiles({
    role: context.membership.role,
    archivedAt: order.archived_at,
  });
  if (!mutate.ok) {
    return NextResponse.json(mutate.body, { status: mutate.status });
  }

  const { data: file, error: fileError } = await supabase
    .from("order_files")
    .select(
      "id, original_name, content_type, size_bytes, status, storage_key, upload_expires_at, completed_at, uploaded_by, created_at, deleted_at"
    )
    .eq("id", fileId)
    .eq("order_id", orderId)
    .eq("tenant_id", context.tenant.id)
    .maybeSingle();

  if (fileError || !file) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  if (file.deleted_at) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  if (file.status === "ready") {
    return NextResponse.json({
      file: toPublicOrderFileDto(file as Record<string, unknown>),
      replay: true,
    });
  }

  if (
    typeof file.upload_expires_at === "string" &&
    new Date(file.upload_expires_at).getTime() < Date.now()
  ) {
    return NextResponse.json(
      { error: "Upload expired", code: "UPLOAD_EXPIRED" },
      { status: 410 }
    );
  }

  let head;
  try {
    head = await headObject({ key: String(file.storage_key) });
  } catch (error) {
    console.error("[POST .../complete] headObject failed", {
      message: error instanceof Error ? error.message : "unknown",
    });
    return NextResponse.json(
      { error: "Could not verify upload" },
      { status: 500 }
    );
  }

  if (!head.exists) {
    return NextResponse.json(
      { error: "Upload incomplete", code: "UPLOAD_INCOMPLETE" },
      { status: 409 }
    );
  }

  const expectedSize = Number(file.size_bytes);
  if (head.contentLength !== expectedSize) {
    return NextResponse.json(
      { error: "Upload size mismatch", code: "UPLOAD_SIZE_MISMATCH" },
      { status: 409 }
    );
  }

  const etag = head.etag ?? `"${expectedSize}"`;

  let signingSecret: string;
  try {
    signingSecret = requireFilesSigningSecret();
  } catch {
    console.error("[POST .../complete] FILES_SIGNING_SECRET missing");
    return NextResponse.json(
      { error: "Could not complete upload" },
      { status: 500 }
    );
  }

  const issuedAt = filesCapabilityIssuedAtNow();
  const capability = createFilesCapability(
    {
      purpose: "complete",
      userId: context.user.id,
      tenantId: context.tenant.id,
      orderId,
      fileId,
      issuedAt,
    },
    signingSecret
  );

  const { data: completed, error: completeError } = await supabase.rpc(
    "complete_order_file_upload",
    {
      p_order_id: orderId,
      p_file_id: fileId,
      p_etag: etag,
      p_issued_at: capability.issuedAt,
      p_signature: capability.signature,
    }
  );

  if (completeError || !completed) {
    console.error("[POST .../complete] complete_order_file_upload failed", {
      message: completeError?.message,
    });
    const mapped = mapOrderFileRpcError(
      completeError,
      "Could not complete upload"
    );
    return NextResponse.json(mapped.body, { status: mapped.status });
  }

  const payload = completed as {
    file?: Record<string, unknown>;
    replay?: unknown;
  };

  return NextResponse.json({
    file: toPublicOrderFileDto(payload.file ?? {}),
    replay: payload.replay === true,
  });
}
