import { NextRequest, NextResponse } from "next/server";
import { assertCanMutateOrderFiles } from "@/lib/files/access";
import {
  createFilesCapability,
  filesCapabilityIssuedAtNow,
  requireFilesSigningSecret,
} from "@/lib/files/capability";
import { assertStorageKeyMatchesIds } from "@/lib/files/object-key";
import { mapOrderFileRpcError } from "@/lib/files/rpc-error";
import { storageDeletionIdFromRpc } from "@/lib/files/storage-deletion";
import { finalizeUserFileDeletion } from "@/lib/files/storage-deletion-server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentContext } from "@/lib/tenant/current-context";

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

  const { data: file, error: fileError } = await supabase
    .from("order_files")
    .select("id, storage_key")
    .eq("id", fileId)
    .eq("order_id", orderId)
    .eq("tenant_id", context.tenant.id)
    .maybeSingle();

  if (fileError || !file) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  if (
    typeof file.storage_key !== "string" ||
    !assertStorageKeyMatchesIds(file.storage_key, {
      tenantId: context.tenant.id,
      orderId,
      fileId,
    })
  ) {
    console.error("[DELETE .../files/:fileId] storage_key invalid", {
      file_id: fileId,
    });
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

  // Reserve first: the RPC hides the file and enqueues the R2 deletion in one
  // transaction. Nothing touches R2 unless this commits.
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

  // Optimisation only; the maintenance cron completes any pending task.
  await finalizeUserFileDeletion(
    storageDeletionIdFromRpc(deleted),
    "[DELETE .../files/:fileId]"
  );

  return new NextResponse(null, { status: 204 });
}
