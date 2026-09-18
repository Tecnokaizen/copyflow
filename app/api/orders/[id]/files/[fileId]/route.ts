import { NextRequest, NextResponse } from "next/server";
import { assertCanMutateOrderFiles } from "@/lib/files/access";
import {
  createFilesCapability,
  filesCapabilityIssuedAtNow,
  requireFilesSigningSecret,
} from "@/lib/files/capability";
import { mapOrderFileRpcError } from "@/lib/files/rpc-error";
import { createClient } from "@/lib/supabase/server";
import { getCurrentContext } from "@/lib/tenant/current-context";
import { deleteObject } from "@/lib/storage/r2";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function DELETE(
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

  let signingSecret: string;
  try {
    signingSecret = requireFilesSigningSecret();
  } catch {
    console.error("[DELETE .../files/:fileId] FILES_SIGNING_SECRET missing");
    return NextResponse.json({ error: "Could not delete file" }, { status: 500 });
  }

  const issuedAt = filesCapabilityIssuedAtNow();
  const capability = createFilesCapability(
    {
      purpose: "delete",
      userId: context.user.id,
      tenantId: context.tenant.id,
      orderId,
      fileId,
      issuedAt,
    },
    signingSecret
  );

  const { data: deleted, error: deleteError } = await supabase.rpc(
    "soft_delete_order_file",
    {
      p_order_id: orderId,
      p_file_id: fileId,
      p_issued_at: capability.issuedAt,
      p_signature: capability.signature,
    }
  );

  if (deleteError || !deleted) {
    console.error("[DELETE .../files/:fileId] soft_delete_order_file failed", {
      message: deleteError?.message,
    });
    const mapped = mapOrderFileRpcError(deleteError, "Could not delete file");
    return NextResponse.json(mapped.body, { status: mapped.status });
  }

  const payload = deleted as {
    storage_key?: unknown;
    replay?: unknown;
  };

  if (payload.replay === true) {
    return new NextResponse(null, { status: 204 });
  }

  if (typeof payload.storage_key === "string") {
    try {
      await deleteObject({ key: payload.storage_key });
    } catch (error) {
      console.error(
        "[DELETE .../files/:fileId] R2 delete failed (metadata deleted)",
        {
          message: error instanceof Error ? error.message : "unknown",
          file_id: fileId,
        }
      );
    }
  }

  return new NextResponse(null, { status: 204 });
}
