import { NextRequest, NextResponse } from "next/server";
import {
  createQuoteFilesCapability,
  filesCapabilityIssuedAtNow,
  requireFilesSigningSecret,
} from "@/lib/files/capability";
import { mapOrderFileRpcError } from "@/lib/files/rpc-error";
import { requireQuotesAccess } from "@/lib/quotes/guard";
import { deleteObject } from "@/lib/storage/r2";

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
    .select("id, storage_key, deleted_at")
    .eq("id", fileId)
    .eq("quote_id", quoteId)
    .eq("tenant_id", context.tenant.id)
    .maybeSingle();

  if (fileError || !file || typeof file.storage_key !== "string") {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  try {
    await deleteObject({ key: file.storage_key });
  } catch {
    return NextResponse.json({ error: "Could not delete file" }, { status: 502 });
  }

  if (file.deleted_at) {
    return new NextResponse(null, { status: 204 });
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

  const { error: deleteError } = await supabase.rpc("soft_delete_quote_file", {
    p_quote_id: quoteId,
    p_file_id: fileId,
    p_issued_at: capability.issuedAt,
    p_signature: capability.signature,
  });

  if (deleteError) {
    const mapped = mapOrderFileRpcError(deleteError, "Could not delete file");
    return NextResponse.json(mapped.body, { status: mapped.status });
  }

  return new NextResponse(null, { status: 204 });
}
