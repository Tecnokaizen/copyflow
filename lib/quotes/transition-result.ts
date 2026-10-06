import { QUOTE_MESSAGES } from "@/lib/quotes/errors";
export function transitionFailure(body: { error?: string; row_version?: unknown }) {
  const code = body.error;
  return {
    status: code === "not_found" ? 404 : code === "conflict" || code === "invalid_state" ? 409 : 422,
    body: { error: code === "conflict" ? QUOTE_MESSAGES.version : code === "not_found" ? QUOTE_MESSAGES.notFound :
      code === "pdf_required" ? "Prepara el PDF oficial antes de continuar." : code === "invalid_relation" ? "Selecciona una tienda, servicio y responsable activos de esta organización." : code === "no_initial_status" ? "Configura un estado inicial de pedido en esta organización." : "El estado actual no permite esta acción.",
      code: code === "conflict" ? "stale_row_version" : code,
      ...(code === "conflict" ? { current_row_version: body.row_version } : {}) },
  };
}
