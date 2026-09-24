import { NextRequest, NextResponse } from "next/server";
import {
  createQuoteFilesCapability,
  filesCapabilityIssuedAtNow,
  requireFilesSigningSecret,
} from "@/lib/files/capability";
import { uploadHeadFailure } from "@/lib/files/complete-head";
import { toPublicOrderFileDto } from "@/lib/files/dto";
import { mapOrderFileRpcError } from "@/lib/files/rpc-error";
import { requireQuotesAccess } from "@/lib/quotes/guard";
import { headObject } from "@/lib/storage/r2";

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
    .select(
      "id, original_name, content_type, size_bytes, status, storage_key, upload_expires_at, completed_at, uploaded_by, created_at, deleted_at"
    )
    .eq("id", fileId)
    .eq("quote_id", quoteId)
    .eq("tenant_id", context.tenant.id)
    .maybeSingle();

  if (fileError || !file || file.deleted_at) {
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
  } catch {
    return NextResponse.json(
      { error: "Could not verify upload" },
      { status: 500 }
    );
  }

  const expectedSize = Number(file.size_bytes);
  const failure = uploadHeadFailure(head, expectedSize);
  if (failure === "missing") {
    return NextResponse.json(
      { error: "Upload incomplete", code: "UPLOAD_INCOMPLETE" },
      { status: 409 }
    );
  }
  if (failure === "mismatch") {
    return NextResponse.json(
      { error: "Upload size mismatch", code: "UPLOAD_SIZE_MISMATCH" },
      { status: 409 }
    );
  }

  let signingSecret: string;
  try {
    signingSecret = requireFilesSigningSecret();
  } catch {
    return NextResponse.json(
      { error: "Could not complete upload" },
      { status: 500 }
    );
  }

  const issuedAt = filesCapabilityIssuedAtNow();
  const capability = createQuoteFilesCapability(
    {
      purpose: "complete",
      userId: context.user.id,
      tenantId: context.tenant.id,
      quoteId,
      fileId,
      issuedAt,
    },
    signingSecret
  );

  const { data: completed, error: completeError } = await supabase.rpc(
    "complete_quote_file_upload",
    {
      p_quote_id: quoteId,
      p_file_id: fileId,
      p_etag: head.etag ?? `"${expectedSize}"`,
      p_issued_at: capability.issuedAt,
      p_signature: capability.signature,
    }
  );

  if (completeError || !completed) {
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
