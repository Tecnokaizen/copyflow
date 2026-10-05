import { NextRequest } from "next/server";
import { requireQuotesAccess } from "@/lib/quotes/guard";
import { operationalJson } from "@/lib/http/operational-cache";
import { isUuid } from "@/lib/team/payload";
import { preparePdfDocument, loadPdfVersion, officialPdfFile } from "@/lib/quotes/pdf/server";
import { QuotePdfError } from "@/lib/quotes/pdf/generate";
import { contentDispositionAttachment } from "@/lib/files/access";
import { GET_PRESIGN_TTL_SECONDS } from "@/lib/files/validation";
import { presignGet } from "@/lib/storage/r2";

// Node.js is the default runtime; explicit runtime config is disabled by Cache Components.
export const maxDuration = 60;
type Context = { params: Promise<{ id: string; versionId: string }> };
function failure(error: unknown) {
  return error instanceof QuotePdfError
    ? operationalJson({ error: error.message, code: error.code }, { status: error.status })
    : operationalJson({ error: "No se pudo preparar el PDF. Puedes reintentar.", code: "PDF_PROVIDER_ERROR" }, { status: 503 });
}
export async function POST(_request: NextRequest, { params }: Context) {
  const access = await requireQuotesAccess(); if (!access.ok) return access.response;
  const { id, versionId } = await params;
  if (!isUuid(id) || !isUuid(versionId)) return operationalJson({ error: "Versión no encontrada." }, { status: 404 });
  try {
    const result = await preparePdfDocument({ db: access.supabase, tenantId: access.context.tenant.id,
      userId: access.context.user.id, quoteId: id, versionId });
    return operationalJson({ ...result, version_id: versionId,
      preview_endpoint: `/api/quotes/${id}/versions/${versionId}/pdf`,
      download_endpoint: `/api/quotes/${id}/versions/${versionId}/pdf?download=1` });
  } catch (error) { return failure(error); }
}
// Same-origin authenticated entry point, short-lived private R2 redirect. No permanent key/URL in UI.
export async function GET(request: NextRequest, { params }: Context) {
  const access = await requireQuotesAccess(); if (!access.ok) return access.response;
  const { id, versionId } = await params;
  if (!isUuid(id) || !isUuid(versionId)) return operationalJson({ error: "Versión no encontrada." }, { status: 404 });
  try {
    const { version } = await loadPdfVersion(access.supabase, access.context.tenant.id, id, versionId);
    if (!version.pdf_file_id) throw new QuotePdfError("PDF_NOT_GENERATED", "Esta versión todavía no tiene PDF.", 404);
    const file = await officialPdfFile(access.supabase, access.context.tenant.id, id, versionId, version.pdf_file_id);
    const url = await presignGet({ key: file.storage_key, expiresIn: GET_PRESIGN_TTL_SECONDS,
      responseContentType: "application/pdf", responseContentDisposition: request.nextUrl.searchParams.get("download") === "1"
        ? contentDispositionAttachment(file.original_name) : "inline" });
    return new Response(null, { status: 307, headers: { Location: url, "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" } });
  } catch (error) { return failure(error); }
}
