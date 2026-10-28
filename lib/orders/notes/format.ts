import type { NoteEventAction, NoteState, NoteVisibility } from "@/lib/orders/notes/types";

// Spanish copy of the post-its (main.md §3). Status is always text, never only colour.

export const NOTE_STATE_LABELS: Record<NoteState, string> = {
  open: "Abierta",
  resolved: "Resuelta",
  voided: "Anulada",
};

export const NOTE_VISIBILITY_LABELS: Record<NoteVisibility, string> = {
  internal: "Interna",
  printable: "Imprimible",
};

export const NOTE_VISIBILITY_HINTS: Record<NoteVisibility, string> = {
  internal: "Solo en pantalla. No se imprime.",
  printable: "Sale en la Hoja de trabajo. Nunca en el Resguardo del cliente.",
};

export const NOTE_EVENT_LABELS: Record<NoteEventAction, string> = {
  created: "creó la nota",
  edited: "editó el texto",
  printable_authorized: "autorizó imprimirla",
  made_internal: "la pasó a interna",
  pinned: "la fijó",
  unpinned: "la desfijó",
  resolved: "la resolvió",
  reopened: "la reabrió",
  voided: "la anuló",
  converted_from_legacy: "la pasó desde las notas anteriores",
  redacted: "suprimió el texto",
};

export const SUPPRESSED_TEXT_LABEL = "Texto suprimido";

function sameLocalDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** «Hoy, 10:32» for today; «27/10/2026, 10:32» otherwise. Browser time zone. */
export function formatNoteDate(value: string | null | undefined, now: Date = new Date()): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const time = new Intl.DateTimeFormat("es-ES", { hour: "2-digit", minute: "2-digit" }).format(date);
  if (sameLocalDay(date, now)) {
    return `Hoy, ${time}`;
  }
  const day = new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
  return `${day}, ${time}`;
}

export function noteEventLabel(action: string): string {
  return NOTE_EVENT_LABELS[action as NoteEventAction] ?? "cambió la nota";
}
