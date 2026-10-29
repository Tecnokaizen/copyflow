// SUR4 contract §9: RPC error codes of the post-it RPCs mapped to HTTP.
// not_found 404 · forbidden 403 · conflict and order_archived 409 · any other
// validation error 422 · anything unknown 500. Messages are shown as is.

export type NotesFailure = {
  status: number;
  body: { error: string; code: string; row_version?: string };
};

export const NOTE_MESSAGES = {
  orderNotFound: "No se encontró el pedido",
  noteNotFound: "No se encontró la nota",
  forbidden: "No tienes permiso para hacer esto con las notas del pedido.",
  ownerOnly: "Solo el propietario de la cuenta puede suprimir el texto de una nota.",
  archived: "El pedido está archivado: sus notas son de solo lectura.",
  conflict: "La nota ha cambiado mientras la tenías abierta. Revisa la versión actual e inténtalo de nuevo.",
  orderConflict: "El pedido ha cambiado mientras lo tenías abierto. Recarga la ficha e inténtalo de nuevo.",
  voidedConflict: "La nota ya está anulada y no admite más cambios.",
  invalidBody: "Escribe el texto de la nota (máximo 4000 caracteres).",
  invalidVisibility: "La visibilidad de la nota no es válida.",
  tooManyNotes: "Este pedido ya tiene 200 notas, el máximo permitido. No se pueden añadir más.",
  addresseeUnavailable: "La persona elegida ya no está activa en el equipo. Elige otra o deja la nota sin destinatario.",
  reasonRequired: "Escribe el motivo para anular la nota.",
  invalidReason: "El motivo no puede superar 500 caracteres.",
  invalidAction: "La acción no es válida.",
  printableConfirmation: "Confirma el texto que se imprimirá antes de marcar la nota como imprimible.",
  noLegacyNotes: "Este pedido no tiene notas anteriores que pasar a post-it.",
  confirmationRequired: "Confirma la supresión para continuar.",
  invalidReasonCode: "Elige el motivo de la supresión en la lista.",
  invalidReasonTarget: "Alguno de los motivos señalados no pertenece a esta nota.",
  invalidVersion: "Falta la versión actual. Recarga la ficha e inténtalo de nuevo.",
  invalidJson: "La petición no es válida.",
  unexpected: "No se pudo completar la acción con las notas. Inténtalo de nuevo.",
  load: "No se pudieron cargar las notas del pedido.",
} as const;

const RPC_ERRORS: Record<string, { status: number; error: string }> = {
  not_found: { status: 404, error: NOTE_MESSAGES.noteNotFound },
  forbidden: { status: 403, error: NOTE_MESSAGES.forbidden },
  order_archived: { status: 409, error: NOTE_MESSAGES.archived },
  conflict: { status: 409, error: NOTE_MESSAGES.conflict },
  invalid_body: { status: 422, error: NOTE_MESSAGES.invalidBody },
  invalid_visibility: { status: 422, error: NOTE_MESSAGES.invalidVisibility },
  too_many_notes: { status: 422, error: NOTE_MESSAGES.tooManyNotes },
  addressee_unavailable: { status: 422, error: NOTE_MESSAGES.addresseeUnavailable },
  reason_required: { status: 422, error: NOTE_MESSAGES.reasonRequired },
  invalid_reason: { status: 422, error: NOTE_MESSAGES.invalidReason },
  invalid_action: { status: 422, error: NOTE_MESSAGES.invalidAction },
  printable_confirmation_required: { status: 422, error: NOTE_MESSAGES.printableConfirmation },
  no_legacy_notes: { status: 422, error: NOTE_MESSAGES.noLegacyNotes },
  confirmation_required: { status: 422, error: NOTE_MESSAGES.confirmationRequired },
  invalid_reason_code: { status: 422, error: NOTE_MESSAGES.invalidReasonCode },
  invalid_reason_target: { status: 422, error: NOTE_MESSAGES.invalidReasonTarget },
};

export function notesFailure(code: string, rowVersion?: unknown): NotesFailure {
  const known = RPC_ERRORS[code];
  if (!known) {
    return { status: 500, body: { error: NOTE_MESSAGES.unexpected, code: "unexpected" } };
  }
  const body: NotesFailure["body"] = { error: known.error, code };
  if (code === "conflict" && (typeof rowVersion === "string" || typeof rowVersion === "number")) {
    body.row_version = String(rowVersion);
  }
  return { status: known.status, body };
}

export function notesError(status: number, code: string, error: string): NotesFailure {
  return { status, body: { error, code } };
}
