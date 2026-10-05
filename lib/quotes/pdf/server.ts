import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createQuoteFilesCapability, filesCapabilityIssuedAtNow, requireFilesSigningSecret } from "@/lib/files/capability";
import { mapOrderFileRpcError } from "@/lib/files/rpc-error";
import { getObjectBytes, headDocument, putDocumentOnce } from "@/lib/storage/r2";
import { logoKeyBelongsToTenant, LOGO_MAX_BYTES, sniffLogoContentType, storedLogoFromBranding } from "@/lib/tenant/branding";
import { isUuid } from "@/lib/team/payload";
import { QUOTE_VERSION_SELECT } from "@/lib/quotes/types";
import { quoteDocumentModel, record } from "./model";
import { renderQuotePdf } from "./render";
import { generateQuotePdf, QuotePdfError, validPdfHead, type PdfFile, type PdfReservation } from "./generate";

export async function loadPdfVersion(db: SupabaseClient, tenantId: string, quoteId: string, versionId: string) {
  const { data: quote, error: qe } = await db.from("quotes").select("id,reference").eq("id", quoteId).eq("tenant_id", tenantId).maybeSingle();
  const { data: version, error: ve } = await db.from("quote_versions").select(`${QUOTE_VERSION_SELECT},seller_snapshot,client_snapshot`)
    .eq("id", versionId).eq("quote_id", quoteId).eq("tenant_id", tenantId).maybeSingle();
  if (qe || ve) throw new QuotePdfError("DATABASE_ERROR", "No se pudo consultar el documento.");
  if (!quote || !version) throw new QuotePdfError("NOT_FOUND", "Presupuesto o versión no encontrados.", 404);
  if (!["prepared", "sent"].includes(version.state)) throw new QuotePdfError("VERSION_NOT_PREPARED", "Prepara la versión antes de generar su PDF.", 409);
  return { quote, version };
}
export async function officialPdfFile(db: SupabaseClient, tenantId: string, quoteId: string, versionId: string, fileId: string): Promise<PdfFile & { storage_key: string }> {
  const { data: file, error } = await db.from("quote_files").select("id,original_name,content_type,size_bytes,status,completed_at,storage_key")
    .eq("id", fileId).eq("tenant_id", tenantId).eq("quote_id", quoteId).eq("pdf_version_id", versionId).eq("status", "ready")
    .eq("content_type", "application/pdf").is("deleted_at", null).maybeSingle();
  if (error || !file) throw new QuotePdfError("PDF_UNAVAILABLE", "El PDF oficial requiere recuperación técnica.", 409);
  return file;
}
export function publicPdfFile(file: PdfFile): PdfFile {
  return { id: file.id, original_name: file.original_name, content_type: file.content_type,
    size_bytes: Number(file.size_bytes), status: file.status, completed_at: file.completed_at };
}
export async function preparePdfDocument(input: { db: SupabaseClient; tenantId: string; userId: string; quoteId: string; versionId: string }) {
  const { db, tenantId, quoteId, versionId, userId } = input;
  const { version } = await loadPdfVersion(db, tenantId, quoteId, versionId);
  // Idempotent read precedes render (even if fonts/template/branding have changed since generation).
  if (version.pdf_file_id) {
    const file = await officialPdfFile(db, tenantId, quoteId, versionId, version.pdf_file_id);
    if (!validPdfHead(await headDocument({ key: file.storage_key }), file)) throw new QuotePdfError("PDF_UNAVAILABLE", "El PDF oficial requiere recuperación técnica.");
    return { file: publicPdfFile(file), replayed: true };
  }
  const { data: source, error } = await db.rpc("quote_pdf_source_v1", { p_tenant_id: tenantId, p_quote_id: quoteId, p_version_id: versionId });
  if (error || !source) throw new QuotePdfError("DATABASE_ERROR", "No se pudieron cargar los datos del documento.");
  const document = record(source);
  const model = quoteDocumentModel(String(document.reference), document.version, Array.isArray(document.items) ? document.items : []);
  const logoRef = storedLogoFromBranding(record(version.seller_snapshot).branding);
  let logo: Buffer | undefined;
  if (logoRef) {
    if (!logoKeyBelongsToTenant(logoRef.storageKey, tenantId) || !isUuid(logoRef.storageKey.slice(`branding/${tenantId}/logo/`.length))) throw new QuotePdfError("INVALID_LOGO", "El logotipo del documento no es válido.");
    const head = await headDocument({ key: logoRef.storageKey });
    if (!head.exists || !head.contentLength || head.contentLength > LOGO_MAX_BYTES) throw new QuotePdfError("INVALID_LOGO", "El logotipo congelado no está disponible.");
    const asset = await getObjectBytes({ key: logoRef.storageKey });
    if (!asset || asset.body.length > LOGO_MAX_BYTES || sniffLogoContentType(asset.body) !== logoRef.contentType) throw new QuotePdfError("INVALID_LOGO", "El logotipo congelado no está disponible.");
    if (logoRef.contentType === "image/webp") throw new QuotePdfError("UNSUPPORTED_LOGO", "El PDF V1 necesita el logotipo en PNG o JPEG.", 422);
    logo = Buffer.from(asset.body);
  }
  const secret = requireFilesSigningSecret();
  function capability(purpose: "create" | "complete", fileId: string) {
    return createQuoteFilesCapability({ purpose, userId, tenantId, quoteId, fileId, issuedAt: filesCapabilityIssuedAtNow() }, secret);
  }
  async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
    const { data, error } = await db.rpc(name, args);
    if (error || !data) {
      const mapped = mapOrderFileRpcError(error, "No se pudo preparar el PDF.");
      if (error?.message?.includes("version_not_prepared")) throw new QuotePdfError("VERSION_NOT_PREPARED", "La versión debe estar preparada.", 409);
      if (mapped.body.code === "STORAGE_QUOTA_EXCEEDED") throw new QuotePdfError("STORAGE_QUOTA_EXCEEDED", "No queda espacio suficiente en la cuota de archivos de la organización.", 409);
      throw new QuotePdfError(String(mapped.body.code ?? "PDF_DATABASE_ERROR"), String(mapped.body.error), mapped.status);
    }
    return data as T;
  }
  const result = await generateQuotePdf({
    render: () => renderQuotePdf(model, logo),
    reserve: (size) => { const id = randomUUID(), cap = capability("create", id);
      return rpc<PdfReservation>("reserve_quote_pdf_v1", { p_quote_id: quoteId, p_version_id: versionId, p_file_id: id,
        p_size_bytes: size, p_issued_at: cap.issuedAt, p_signature: cap.signature }); },
    head: (key) => headDocument({ key }), putOnce: (key, body, sha256) => putDocumentOnce({ key, body, sha256 }),
    finish: (id, etag) => { const cap = capability("complete", id);
      return rpc<{ file: PdfFile; replayed: boolean }>("finish_quote_pdf_v1", { p_quote_id: quoteId, p_version_id: versionId,
        p_file_id: id, p_etag: etag, p_issued_at: cap.issuedAt, p_signature: cap.signature }); },
  });
  return { ...result, file: publicPdfFile(result.file) };
}
