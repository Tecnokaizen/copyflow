import type {
  ConvertLegacyNotesResponse,
  NoteMutationResponse,
  NoteRedactReasonCode,
  NoteStateAction,
  NoteVisibility,
  OrderNoteHistoryResponse,
  OrderNotesListResponse,
} from "@/lib/orders/notes/types";

// Browser calls to /api/orders/[id]/notes/**. Errors carry the server's
// Spanish message, its code and, on conflict, the current row_version.

export class NotesRequestError extends Error {
  readonly status: number;
  readonly code: string;
  readonly rowVersion: string | null;

  constructor(message: string, status: number, code: string, rowVersion: string | null) {
    super(message);
    this.name = "NotesRequestError";
    this.status = status;
    this.code = code;
    this.rowVersion = rowVersion;
  }
}

const OUR_CODE = /^[a-z_]+$/;

function fallbackMessage(status: number) {
  if (status === 401) return "Tu sesión ha caducado. Vuelve a iniciar sesión.";
  if (status === 403) return "No tienes permiso para hacer esto con las notas del pedido.";
  if (status === 404) return "No se encontró la nota o el pedido.";
  if (status === 503) return "El servicio no está disponible ahora mismo. Inténtalo de nuevo en unos segundos.";
  return "No se pudo completar la acción con las notas. Inténtalo de nuevo.";
}

async function send<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { cache: "no-store", ...init });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new NotesRequestError("No hay conexión con el servidor. Inténtalo de nuevo.", 0, "network", null);
  }
  let body: Record<string, unknown> | null = null;
  try {
    body = (await response.json()) as Record<string, unknown>;
  } catch {
    body = null;
  }
  if (!response.ok) {
    const code = typeof body?.code === "string" ? body.code : "";
    const ours = OUR_CODE.test(code);
    const message = ours && typeof body?.error === "string" ? body.error : fallbackMessage(response.status);
    const rowVersion = typeof body?.row_version === "string" ? body.row_version : null;
    throw new NotesRequestError(message, response.status, ours ? code : "http_error", rowVersion);
  }
  return body as T;
}

function post<T>(url: string, payload: unknown, method = "POST") {
  return send<T>(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

const base = (orderId: string) => `/api/orders/${encodeURIComponent(orderId)}/notes`;
const noteUrl = (orderId: string, noteId: string) => `${base(orderId)}/${encodeURIComponent(noteId)}`;

export const orderNotesApi = {
  list(orderId: string, options: { includeVoided?: boolean; signal?: AbortSignal } = {}) {
    return send<OrderNotesListResponse>(`${base(orderId)}${options.includeVoided ? "?voided=1" : ""}`, {
      signal: options.signal,
    });
  },
  create(
    orderId: string,
    input: {
      body: string;
      visibility: NoteVisibility;
      pinned: boolean;
      addressee_team_member_id: string | null;
      confirm_printable: boolean;
    }
  ) {
    return post<NoteMutationResponse>(base(orderId), input);
  },
  update(
    orderId: string,
    noteId: string,
    input: { expected_row_version: string; body?: string; visibility?: NoteVisibility; confirm_printable?: boolean }
  ) {
    return post<NoteMutationResponse>(noteUrl(orderId, noteId), input, "PATCH");
  },
  setState(orderId: string, noteId: string, action: NoteStateAction, reason?: string) {
    return post<NoteMutationResponse>(`${noteUrl(orderId, noteId)}/state`, { action, reason: reason ?? null });
  },
  history(orderId: string, noteId: string, signal?: AbortSignal) {
    return send<OrderNoteHistoryResponse>(noteUrl(orderId, noteId), { signal });
  },
  redact(orderId: string, noteId: string, input: { reason_code: NoteRedactReasonCode; reason_event_ids: string[] }) {
    return post<NoteMutationResponse>(`${noteUrl(orderId, noteId)}/redact`, { ...input, confirm: true });
  },
  convertLegacy(orderId: string, expectedVersion: string) {
    return post<ConvertLegacyNotesResponse>(`${base(orderId)}/convert-legacy`, { expected_version: expectedVersion });
  },
};

export function notesErrorMessage(error: unknown): string {
  if (error instanceof NotesRequestError) return error.message;
  return fallbackMessage(500);
}
