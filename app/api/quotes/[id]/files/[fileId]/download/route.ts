import { NextRequest, NextResponse } from "next/server";
import { contentDispositionAttachment } from "@/lib/files/access";
import { GET_PRESIGN_TTL_SECONDS } from "@/lib/files/validation";
import { requireQuotesAccess } from "@/lib/quotes/guard";
import { presignGet } from "@/lib/storage/r2";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(
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

  const { data: file, error: fileError } = await supabase
    .from("quote_files")
    .select("id, original_name, content_type, status, storage_key, deleted_at")
    .eq("id", fileId)
    .eq("quote_id", quoteId)
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
  } catch {
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
