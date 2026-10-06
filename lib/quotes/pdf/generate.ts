import { createHash } from "node:crypto";

export type PdfFile = { id: string; original_name: string; content_type: string; size_bytes: number; status: string; completed_at: string | null };
export type PdfReservation = { file: PdfFile; storage_key: string; upload_expires_at: string; linked: boolean };
export type PdfHead = { exists: boolean; contentLength: number | null; contentType: string | null; etag: string | null; sha256: string | null };
export class QuotePdfError extends Error {
  constructor(public code: string, message: string, public status = 503) { super(message); }
}
export type PdfProvider = {
  render: () => Promise<Buffer>;
  reserve: (size: number) => Promise<PdfReservation>;
  head: (key: string) => Promise<PdfHead>;
  putOnce: (key: string, body: Buffer, sha256: string) => Promise<void>;
  finish: (id: string, etag: string) => Promise<{ file: PdfFile; replayed: boolean }>;
};
export function validPdfHead(head: PdfHead, file: PdfFile) {
  return file.content_type === "application/pdf" && head.exists && head.contentType === "application/pdf"
    && head.contentLength === Number(file.size_bytes) && !!head.etag;
}
// Provider failures leave pending metadata intact. Never compensate an ambiguous commit by deleting R2.
export async function generateQuotePdf(provider: PdfProvider) {
  const buffer = await provider.render();
  if (!Buffer.isBuffer(buffer) || buffer.subarray(0, 5).toString() !== "%PDF-") throw new QuotePdfError("INVALID_PDF", "No se pudo generar un PDF válido.");
  const digest = createHash("sha256").update(buffer).digest("hex");
  const reservation = await provider.reserve(buffer.length);
  const { file, storage_key: key } = reservation;
  let head = await provider.head(key);
  if (reservation.linked) {
    if (file.status !== "ready" || !validPdfHead(head, file)) throw new QuotePdfError("PDF_UNAVAILABLE", "El PDF oficial requiere recuperación técnica.");
    return { file, replayed: true };
  }
  if (Date.parse(reservation.upload_expires_at) - Date.now() < 120_000) throw new QuotePdfError("UPLOAD_EXPIRED", "Reserva expirada. Reintenta después de la limpieza de archivos temporales.", 410);
  if (!head.exists) {
    await provider.putOnce(key, buffer, digest);
    head = await provider.head(key);
  }
  if (!validPdfHead(head, file) || head.sha256 !== digest) throw new QuotePdfError("PDF_OBJECT_MISMATCH", "No se pudo verificar el PDF almacenado.");
  return provider.finish(file.id, head.etag!);
}
