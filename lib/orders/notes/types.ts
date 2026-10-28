// SUR4 E6 · Post-its del pedido: shapes shared by the API routes and the
// client components. The database (E5, 20261028120000_order_notes_v1.sql) is
// the authority; these types describe what the routes return.

export const NOTE_STATES = ["open", "resolved", "voided"] as const;
export type NoteState = (typeof NOTE_STATES)[number];

export const NOTE_VISIBILITIES = ["internal", "printable"] as const;
export type NoteVisibility = (typeof NOTE_VISIBILITIES)[number];

export const NOTE_STATE_ACTIONS = ["pin", "unpin", "resolve", "reopen", "void"] as const;
export type NoteStateAction = (typeof NOTE_STATE_ACTIONS)[number];

/** N22: closed list, no free text, so the reason never repeats the data. */
export const NOTE_REDACT_REASON_CODES = ["personal_data_request", "personal_data_found"] as const;
export type NoteRedactReasonCode = (typeof NOTE_REDACT_REASON_CODES)[number];

export const NOTE_REDACT_REASON_LABELS: Record<NoteRedactReasonCode, string> = {
  personal_data_request: "Petición de la persona interesada",
  personal_data_found: "Dato personal detectado por el equipo",
};

/** Same limits as the database: visible characters, raw HTML, reasons, notes per order. */
export const NOTE_MAX_PLAIN_LENGTH = 4000;
export const NOTE_MAX_HTML_LENGTH = 20000;
export const NOTE_MAX_REASON_LENGTH = 500;
export const NOTES_PER_ORDER_LIMIT = 200;

/** What a redaction leaves in place of a flagged reason. */
export const REDACTED_REASON = "[motivo suprimido]";

export type NotePermissions = {
  edit: boolean;
  pin: boolean;
  resolve: boolean;
  reopen: boolean;
  void: boolean;
  redact: boolean;
};

export type OrderNoteView = {
  id: string;
  /** Sanitized rich text; null once the text was suppressed (N22). */
  body: string | null;
  redacted: boolean;
  visibility: NoteVisibility;
  state: NoteState;
  pinned: boolean;
  addressee: { id: string; name: string; active: boolean } | null;
  author: { user_id: string; name: string };
  is_own: boolean;
  /** Opaque concurrency token of the note (never the order's). */
  row_version: string;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  voided_at: string | null;
  void_reason: string | null;
  printable_authorized_at: string | null;
  permissions: NotePermissions;
};

export type NoteAddresseeOption = { id: string; name: string };

export type OrderNotesListResponse = {
  order_id: string;
  archived: boolean;
  can_create: boolean;
  /** Notes of the order in any state; the 200 limit counts voided ones too. */
  total: number;
  voided_count: number;
  limit: number;
  include_voided: boolean;
  notes: OrderNoteView[];
  addressees: NoteAddresseeOption[];
};

export type NoteVersionView = {
  id: string;
  version: number;
  /** null when the text was suppressed. */
  body: string | null;
  redacted: boolean;
  created_at: string;
};

export type NoteEventAction =
  | "created"
  | "edited"
  | "printable_authorized"
  | "made_internal"
  | "pinned"
  | "unpinned"
  | "resolved"
  | "reopened"
  | "voided"
  | "converted_from_legacy"
  | "redacted";

export type NoteHistoryEvent = {
  id: string;
  action: NoteEventAction;
  actor_name: string;
  created_at: string;
  reason: string | null;
  reason_redacted: boolean;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  version_before: NoteVersionView | null;
  version_after: NoteVersionView | null;
};

export type OrderNoteHistoryResponse = {
  note: OrderNoteView;
  events: NoteHistoryEvent[];
  versions: NoteVersionView[];
};

export type NoteMutationResponse = {
  ok: true;
  changed: boolean;
  note: OrderNoteView;
};

export type ConvertLegacyNotesResponse = {
  ok: true;
  /** New order row_version: the parent must adopt it. */
  version: string;
  note_id: string;
};

export type NotesErrorBody = {
  error: string;
  code: string;
  row_version?: string;
};

export function isNoteVisibility(value: unknown): value is NoteVisibility {
  return NOTE_VISIBILITIES.includes(value as NoteVisibility);
}

export function isNoteStateAction(value: unknown): value is NoteStateAction {
  return NOTE_STATE_ACTIONS.includes(value as NoteStateAction);
}

export function isNoteRedactReasonCode(value: unknown): value is NoteRedactReasonCode {
  return NOTE_REDACT_REASON_CODES.includes(value as NoteRedactReasonCode);
}
