import { NextRequest, NextResponse } from "next/server";
import {
  createQuoteFilesCapability,
  filesCapabilityIssuedAtNow,
  requireFilesSigningSecret,
} from "@/lib/files/capability";
import { assertQuoteStorageKeyMatchesIds } from "@/lib/files/object-key";
import { mapOrderFileRpcError } from "@/lib/files/rpc-error";
import { storageDeletionIdFromRpc } from "@/lib/files/storage-deletion";
import { finalizeUserFileDeletion } from "@/lib/files/storage-deletion-server";
import { requireQuotesAccess } from "@/lib/quotes/guard";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; fileId: string }> }
) {
  const access = await requireQuotesAccess();
  if (!access.ok) return access.response;

  const { id: quoteId, fileId } = await params;
  if (!UUID_PATTERN.test(quoteId) || !UUID_PATTERN.test(fileId)) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  const { context, supabase } = access;
  const { data: quote, error: quoteError } = await supabase
    .from("quotes")
    .select("id")
    .eq("id", quoteId)
    .eq("tenant_id", context.tenant.id)
    .maybeSingle();
  if (quoteError || !quote) {
    return NextResponse.json({ error: "Quote not found" }, { status: 404 });
  }

  let signingSecret: string;
  try {
    signingSecret = requireFilesSigningSecret();
  } catch {
    return NextResponse.json({ error: "Could not delete file" }, { status: 500 });
  }

  const { data: file, error: fileError } = await supabase
    .from("quote_files")
    .select("id, storage_key")
    .eq("id", fileId)
    .eq("quote_id", quoteId)
    .eq("tenant_id", context.tenant.id)
    .maybeSingle();

  if (fileError || !file) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  if (
    typeof file.storage_key !== "string" ||
    !assertQuoteStorageKeyMatchesIds(file.storage_key, {
      tenantId: context.tenant.id,
      quoteId,
      fileId,
    })
  ) {
    console.error("[DELETE /api/quotes/:id/files/:fileId] storage_key invalid", {
      file_id: fileId,
    });
    return NextResponse.json({ error: "Could not delete file" }, { status: 500 });
  }

  const issuedAt = filesCapabilityIssuedAtNow();
  const capability = createQuoteFilesCapability(
    {
      purpose: "delete",
      userId: context.user.id,
      tenantId: context.tenant.id,
      quoteId,
      fileId,
      issuedAt,
    },
    signingSecret
  );

  // Reserve first. Official PDFs are rejected here, before any R2 call.
  const { data: deleted, error: deleteError } = await supabase.rpc(
    "soft_delete_quote_file",
    {
      p_quote_id: quoteId,
      p_file_id: fileId,
      p_issued_at: capability.issuedAt,
      p_signature: capability.signature,
    }
  );

  if (deleteError || !deleted) {
    const mapped = mapOrderFileRpcError(deleteError, "Could not delete file");
    return NextResponse.json(mapped.body, { status: mapped.status });
  }

  await finalizeUserFileDeletion(
    storageDeletionIdFromRpc(deleted),
    "[DELETE /api/quotes/:id/files/:fileId]"
  );

  return new NextResponse(null, { status: 204 });
}
