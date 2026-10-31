import type { SupabaseClient } from "@supabase/supabase-js";

import { tenantHasFeature } from "@/lib/features/tenant-has-feature";
import { prepareNoteBody } from "@/lib/orders/notes/body";
import { NOTE_MESSAGES, notesError, notesFailure, type NotesFailure } from "@/lib/orders/notes/errors";
import {
  canCreateOrderNote,
  canRedactOrderNotes,
  canWriteOrderNotes,
  computeNotePermissions,
} from "@/lib/orders/notes/permissions";
import {
  NOTE_MAX_REASON_LENGTH,
  NOTES_PER_ORDER_LIMIT,
  REDACTED_REASON,
  isNoteRedactReasonCode,
  isNoteStateAction,
  isNoteVisibility,
  type NoteEventAction,
  type NoteHistoryEvent,
  type NoteState,
  type NoteVersionView,
  type NoteVisibility,
  type OrderNoteHistoryResponse,
  type OrderNoteView,
  type OrderNotesListResponse,
} from "@/lib/orders/notes/types";
import { ORDER_FEATURE_CODES } from "@/lib/orders/order-features";

// SUR4 E6 (contract §9): the logic behind /api/orders/[id]/notes/**. Each route
// authenticates with requireCurrentAccess and hands over the session context;
// the tenant always comes from that context, never from the request body.
// Reads go through RLS (member + order_sticky_notes); writes only through the
// E5 RPCs, which repeat every check.

export type NotesContext = {
  tenant: { id: string };
  user: { id: string };
  membership: { role: string };
};

export type NotesResult = { status: number; body: unknown };

type Db = SupabaseClient;
type Row = Record<string, unknown>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// One hint per team_members embed (SUR4 E1): the addressee FK is composite.
const NOTE_COLUMNS =
  "id, order_id, body, visibility, state, pinned, author_user_id, author_name, row_version, created_at, updated_at, resolved_at, voided_at, void_reason, printable_authorized_at, redacted_at, addressee:team_members!order_notes_addressee_fk(id, name, active)";

const STATE_ORDER: Record<NoteState, number> = { open: 0, resolved: 1, voided: 2 };

function failure(result: NotesFailure): NotesResult {
  return { status: result.status, body: result.body };
}

function ok(body: unknown): NotesResult {
  return { status: 200, body };
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asVersion(value: unknown): string | null {
  if (typeof value === "string" && /^[0-9]+$/.test(value)) return value;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return String(value);
  return null;
}

function asRecord(value: unknown): Row | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Row) : null;
}

/** Body of a write request; undefined when it is not JSON (each handler answers 422). */
export async function readNotesJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

export function isNoteUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

// ---------------------------------------------------------------------------
// Scope: feature, order of the session tenant, note of that order
// ---------------------------------------------------------------------------

type OrderScope = { id: string; archived: boolean };

export async function openOrderNotesScope(
  supabase: Db,
  context: NotesContext,
  orderId: string
): Promise<{ ok: true; order: OrderScope } | { ok: false; result: NotesResult }> {
  const notFound = { ok: false as const, result: failure(notesError(404, "not_found", NOTE_MESSAGES.orderNotFound)) };
  if (!isNoteUuid(orderId)) {
    return notFound;
  }
  // Feature off: 404 for every route, reads included (contract §4).
  const enabled = await tenantHasFeature(supabase, context.tenant.id, ORDER_FEATURE_CODES.stickyNotes);
  if (!enabled) {
    return notFound;
  }
  const { data, error } = await supabase
    .from("orders")
    .select("id, archived_at")
    .eq("id", orderId)
    .eq("tenant_id", context.tenant.id)
    .maybeSingle();
  if (error) {
    console.error("[order notes] order lookup failed", { orderId, code: error.code });
    return { ok: false, result: failure(notesError(500, "unexpected", NOTE_MESSAGES.load)) };
  }
  const order = asRecord(data);
  if (!order) {
    return notFound;
  }
  return { ok: true, order: { id: orderId, archived: order.archived_at != null } };
}

async function readNoteRow(
  supabase: Db,
  context: NotesContext,
  orderId: string,
  noteId: string
): Promise<{ ok: true; row: Row } | { ok: false; result: NotesResult }> {
  const notFound = { ok: false as const, result: failure(notesError(404, "not_found", NOTE_MESSAGES.noteNotFound)) };
  if (!isNoteUuid(noteId)) {
    return notFound;
  }
  const { data, error } = await supabase
    .from("order_notes")
    .select(NOTE_COLUMNS)
    .eq("id", noteId)
    .eq("order_id", orderId)
    .eq("tenant_id", context.tenant.id)
    .maybeSingle();
  if (error) {
    console.error("[order notes] note lookup failed", { orderId, noteId, code: error.code });
    return { ok: false, result: failure(notesError(500, "unexpected", NOTE_MESSAGES.load)) };
  }
  const row = asRecord(data);
  return row ? { ok: true, row } : notFound;
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

function readState(value: unknown): NoteState {
  return value === "resolved" || value === "voided" ? value : "open";
}

function readVisibility(value: unknown): NoteVisibility {
  return value === "printable" ? "printable" : "internal";
}

function readAddressee(value: unknown): OrderNoteView["addressee"] {
  const record = asRecord(Array.isArray(value) ? value[0] : value);
  if (!record || typeof record.id !== "string") return null;
  return {
    id: record.id,
    name: typeof record.name === "string" && record.name.trim() ? record.name.trim() : "Persona del equipo",
    active: record.active !== false,
  };
}

export function toNoteView(row: Row, context: NotesContext, archived: boolean): OrderNoteView {
  const state = readState(row.state);
  const redacted = row.redacted_at != null || row.body == null;
  const pinned = row.pinned === true;
  const authorId = asString(row.author_user_id) ?? "";
  return {
    id: String(row.id),
    body: redacted ? null : asString(row.body),
    redacted,
    visibility: readVisibility(row.visibility),
    state,
    pinned,
    addressee: readAddressee(row.addressee),
    author: { user_id: authorId, name: asString(row.author_name) ?? "Usuario" },
    is_own: authorId === context.user.id,
    row_version: asVersion(row.row_version) ?? "0",
    created_at: String(row.created_at ?? ""),
    updated_at: String(row.updated_at ?? row.created_at ?? ""),
    resolved_at: asString(row.resolved_at),
    voided_at: asString(row.voided_at),
    void_reason: asString(row.void_reason),
    printable_authorized_at: asString(row.printable_authorized_at),
    permissions: computeNotePermissions({
      role: context.membership.role,
      userId: context.user.id,
      archived,
      note: { author_user_id: authorId, state, pinned, redacted },
    }),
  };
}

function compareNotes(a: OrderNoteView, b: OrderNoteView) {
  const byState = STATE_ORDER[a.state] - STATE_ORDER[b.state];
  if (byState !== 0) return byState;
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
  return a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0;
}

// ---------------------------------------------------------------------------
// GET /api/orders/[id]/notes
// ---------------------------------------------------------------------------

export async function listOrderNotes(
  supabase: Db,
  context: NotesContext,
  orderId: string,
  includeVoided: boolean
): Promise<NotesResult> {
  const scope = await openOrderNotesScope(supabase, context, orderId);
  if (!scope.ok) return scope.result;

  const { data, error } = await supabase
    .from("order_notes")
    .select(NOTE_COLUMNS)
    .eq("tenant_id", context.tenant.id)
    .eq("order_id", orderId)
    .order("created_at", { ascending: false })
    .limit(NOTES_PER_ORDER_LIMIT + 50);
  if (error) {
    console.error("[order notes] list failed", { orderId, code: error.code });
    return failure(notesError(500, "unexpected", NOTE_MESSAGES.load));
  }

  const archived = scope.order.archived;
  const all = (Array.isArray(data) ? data : [])
    .map(asRecord)
    .filter((row): row is Row => row !== null)
    .map((row) => toNoteView(row, context, archived));
  const voidedCount = all.filter((note) => note.state === "voided").length;
  const notes = (includeVoided ? all : all.filter((note) => note.state !== "voided")).sort(compareNotes);
  const canCreate = canCreateOrderNote({ role: context.membership.role, archived, total: all.length });

  let addressees: OrderNotesListResponse["addressees"] = [];
  if (canCreate) {
    const people = await supabase
      .from("team_members")
      .select("id, name")
      .eq("tenant_id", context.tenant.id)
      .eq("active", true)
      .order("name", { ascending: true });
    addressees = (Array.isArray(people.data) ? people.data : [])
      .map(asRecord)
      .filter((row): row is Row => row !== null && typeof row.id === "string" && typeof row.name === "string")
      .map((row) => ({ id: String(row.id), name: String(row.name).trim() }))
      .filter((person) => person.name.length > 0);
  }

  const response: OrderNotesListResponse = {
    order_id: orderId,
    archived,
    can_create: canCreate,
    total: all.length,
    voided_count: voidedCount,
    limit: NOTES_PER_ORDER_LIMIT,
    include_voided: includeVoided,
    notes,
    addressees,
  };
  return ok(response);
}

// ---------------------------------------------------------------------------
// GET /api/orders/[id]/notes/[noteId]: history (not in contract §9, see E6 report)
// ---------------------------------------------------------------------------

function toVersionView(row: Row): NoteVersionView {
  const redacted = row.redacted_at != null || row.body == null;
  return {
    id: String(row.id),
    version: typeof row.version === "number" ? row.version : Number(row.version ?? 0),
    body: redacted ? null : asString(row.body),
    redacted,
    created_at: String(row.created_at ?? ""),
  };
}

function snapshot(value: unknown): Record<string, unknown> | null {
  return asRecord(value);
}

export async function loadOrderNoteHistory(
  supabase: Db,
  context: NotesContext,
  orderId: string,
  noteId: string
): Promise<NotesResult> {
  const scope = await openOrderNotesScope(supabase, context, orderId);
  if (!scope.ok) return scope.result;
  const note = await readNoteRow(supabase, context, orderId, noteId);
  if (!note.ok) return note.result;

  const [events, versions] = await Promise.all([
    supabase
      .from("order_note_events")
      .select("id, action, actor_name, created_at, reason, before, after, version_before_id, version_after_id")
      .eq("tenant_id", context.tenant.id)
      .eq("note_id", noteId)
      .order("created_at", { ascending: true }),
    supabase
      .from("order_note_versions")
      .select("id, version, body, redacted_at, created_at")
      .eq("tenant_id", context.tenant.id)
      .eq("note_id", noteId)
      .order("version", { ascending: true }),
  ]);
  if (events.error || versions.error) {
    console.error("[order notes] history failed", {
      orderId,
      noteId,
      code: events.error?.code ?? versions.error?.code,
    });
    return failure(notesError(500, "unexpected", NOTE_MESSAGES.load));
  }

  const versionViews = (Array.isArray(versions.data) ? versions.data : [])
    .map(asRecord)
    .filter((row): row is Row => row !== null)
    .map(toVersionView);
  const byId = new Map(versionViews.map((version) => [version.id, version]));

  const eventViews: NoteHistoryEvent[] = (Array.isArray(events.data) ? events.data : [])
    .map(asRecord)
    .filter((row): row is Row => row !== null)
    .map((row) => {
      const reason = asString(row.reason);
      return {
        id: String(row.id),
        action: String(row.action) as NoteEventAction,
        actor_name: asString(row.actor_name) ?? "Usuario",
        created_at: String(row.created_at ?? ""),
        reason,
        reason_redacted: reason === REDACTED_REASON,
        before: snapshot(row.before),
        after: snapshot(row.after),
        version_before: byId.get(String(row.version_before_id)) ?? null,
        version_after: byId.get(String(row.version_after_id)) ?? null,
      };
    });

  const response: OrderNoteHistoryResponse = {
    note: toNoteView(note.row, context, scope.order.archived),
    events: eventViews,
    versions: versionViews,
  };
  return ok(response);
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

type RpcPayload = { ok?: boolean; error?: string; row_version?: unknown; version?: unknown; changed?: boolean; note?: unknown };

async function callRpc(
  supabase: Db,
  name: string,
  args: Record<string, unknown>,
  log: Record<string, unknown>
): Promise<{ ok: true; payload: RpcPayload } | { ok: false; result: NotesResult }> {
  const { data, error } = await supabase.rpc(name, args);
  const payload = asRecord(data) as RpcPayload | null;
  if (error || !payload) {
    console.error(`[order notes] ${name} failed`, { ...log, code: error?.code });
    return { ok: false, result: failure(notesError(500, "unexpected", NOTE_MESSAGES.unexpected)) };
  }
  if (payload.ok !== true) {
    return { ok: false, result: failure(notesFailure(String(payload.error ?? ""), payload.row_version)) };
  }
  return { ok: true, payload };
}

async function mutationResponse(
  supabase: Db,
  context: NotesContext,
  orderId: string,
  noteId: string,
  archived: boolean,
  changed: boolean
): Promise<NotesResult> {
  const note = await readNoteRow(supabase, context, orderId, noteId);
  if (!note.ok) return note.result;
  return ok({ ok: true, changed, note: toNoteView(note.row, context, archived) });
}

function forbidden(): NotesResult {
  return failure(notesError(403, "forbidden", NOTE_MESSAGES.forbidden));
}

// POST /api/orders/[id]/notes
export async function createOrderNote(
  supabase: Db,
  context: NotesContext,
  orderId: string,
  input: unknown
): Promise<NotesResult> {
  const scope = await openOrderNotesScope(supabase, context, orderId);
  if (!scope.ok) return scope.result;
  if (!canWriteOrderNotes(context.membership.role)) return forbidden();

  const payload = asRecord(input);
  if (!payload) return failure(notesError(422, "invalid_body", NOTE_MESSAGES.invalidBody));
  const body = prepareNoteBody(payload.body);
  if (!body.ok) return failure(notesFailure("invalid_body"));
  const visibility = payload.visibility ?? "internal";
  if (!isNoteVisibility(visibility)) return failure(notesFailure("invalid_visibility"));
  const rawAddressee = payload.addressee_team_member_id;
  if (rawAddressee != null && rawAddressee !== "" && !isNoteUuid(rawAddressee)) {
    return failure(notesFailure("addressee_unavailable"));
  }
  const addressee = isNoteUuid(rawAddressee) ? rawAddressee : null;

  const rpc = await callRpc(
    supabase,
    "create_order_note_v1",
    {
      p_order_id: orderId,
      p_body: body.html,
      p_visibility: visibility,
      p_pinned: payload.pinned === true,
      p_addressee: addressee,
      p_confirm_printable: payload.confirm_printable === true,
    },
    { orderId }
  );
  if (!rpc.ok) return rpc.result;
  const noteId = asString(asRecord(rpc.payload.note)?.id);
  if (!noteId) return failure(notesError(500, "unexpected", NOTE_MESSAGES.unexpected));
  const response = await mutationResponse(supabase, context, orderId, noteId, scope.order.archived, true);
  return response.status === 200 ? { status: 201, body: response.body } : response;
}

// PATCH /api/orders/[id]/notes/[noteId]
export async function updateOrderNote(
  supabase: Db,
  context: NotesContext,
  orderId: string,
  noteId: string,
  input: unknown
): Promise<NotesResult> {
  const scope = await openOrderNotesScope(supabase, context, orderId);
  if (!scope.ok) return scope.result;
  const note = await readNoteRow(supabase, context, orderId, noteId);
  if (!note.ok) return note.result;
  if (!canWriteOrderNotes(context.membership.role)) return forbidden();

  const payload = asRecord(input);
  const expected = asVersion(payload?.expected_row_version);
  if (!payload || !expected) return failure(notesError(422, "invalid_version", NOTE_MESSAGES.invalidVersion));

  let html: string | null = null;
  if (payload.body !== undefined && payload.body !== null) {
    const body = prepareNoteBody(payload.body);
    if (!body.ok) return failure(notesFailure("invalid_body"));
    html = body.html;
  }
  let visibility: NoteVisibility | null = null;
  if (payload.visibility !== undefined && payload.visibility !== null) {
    if (!isNoteVisibility(payload.visibility)) return failure(notesFailure("invalid_visibility"));
    visibility = payload.visibility;
  }

  const rpc = await callRpc(
    supabase,
    "update_order_note_v1",
    {
      p_note_id: noteId,
      p_expected_row_version: expected,
      p_body: html,
      p_visibility: visibility,
      p_confirm_printable: payload.confirm_printable === true,
    },
    { orderId, noteId }
  );
  if (!rpc.ok) return rpc.result;
  return mutationResponse(supabase, context, orderId, noteId, scope.order.archived, rpc.payload.changed === true);
}

// POST /api/orders/[id]/notes/[noteId]/state
export async function setOrderNoteState(
  supabase: Db,
  context: NotesContext,
  orderId: string,
  noteId: string,
  input: unknown
): Promise<NotesResult> {
  const scope = await openOrderNotesScope(supabase, context, orderId);
  if (!scope.ok) return scope.result;
  const note = await readNoteRow(supabase, context, orderId, noteId);
  if (!note.ok) return note.result;
  if (!canWriteOrderNotes(context.membership.role)) return forbidden();

  const payload = asRecord(input);
  if (!payload || !isNoteStateAction(payload.action)) return failure(notesFailure("invalid_action"));
  let reason: string | null = null;
  if (payload.reason !== undefined && payload.reason !== null) {
    if (typeof payload.reason !== "string") return failure(notesFailure("invalid_reason"));
    reason = payload.reason.trim() || null;
    if (reason && reason.length > NOTE_MAX_REASON_LENGTH) return failure(notesFailure("invalid_reason"));
  }

  const rpc = await callRpc(
    supabase,
    "set_order_note_state_v1",
    { p_note_id: noteId, p_action: payload.action, p_reason: reason },
    { orderId, noteId, action: payload.action }
  );
  if (!rpc.ok) {
    const body = asRecord(rpc.result.body);
    // Voided is final: any other action on it answers conflict.
    if (body?.code === "conflict" && note.row.state === "voided") {
      return { status: 409, body: { ...body, error: NOTE_MESSAGES.voidedConflict } };
    }
    return rpc.result;
  }
  return mutationResponse(supabase, context, orderId, noteId, scope.order.archived, rpc.payload.changed === true);
}

// POST /api/orders/[id]/notes/[noteId]/redact (N22, owner only)
export async function redactOrderNote(
  supabase: Db,
  context: NotesContext,
  orderId: string,
  noteId: string,
  input: unknown
): Promise<NotesResult> {
  const scope = await openOrderNotesScope(supabase, context, orderId);
  if (!scope.ok) return scope.result;
  const note = await readNoteRow(supabase, context, orderId, noteId);
  if (!note.ok) return note.result;
  if (!canRedactOrderNotes(context.membership.role)) {
    return failure(notesError(403, "forbidden", NOTE_MESSAGES.ownerOnly));
  }

  const payload = asRecord(input);
  if (!payload || payload.confirm !== true) return failure(notesFailure("confirmation_required"));
  if (!isNoteRedactReasonCode(payload.reason_code)) return failure(notesFailure("invalid_reason_code"));
  const rawIds = payload.reason_event_ids ?? [];
  if (!Array.isArray(rawIds) || rawIds.length > 500 || !rawIds.every(isNoteUuid)) {
    return failure(notesFailure("invalid_reason_target"));
  }

  const rpc = await callRpc(
    supabase,
    "redact_order_note_v1",
    {
      p_note_id: noteId,
      p_reason_code: payload.reason_code,
      p_reason_event_ids: [...new Set(rawIds)],
      p_confirm: true,
    },
    { orderId, noteId }
  );
  if (!rpc.ok) return rpc.result;
  return mutationResponse(supabase, context, orderId, noteId, scope.order.archived, rpc.payload.changed === true);
}

// POST /api/orders/[id]/notes/convert-legacy («Pasar a post-it»)
export async function convertLegacyOrderNotes(
  supabase: Db,
  context: NotesContext,
  orderId: string,
  input: unknown
): Promise<NotesResult> {
  const scope = await openOrderNotesScope(supabase, context, orderId);
  if (!scope.ok) return scope.result;
  if (!canWriteOrderNotes(context.membership.role)) return forbidden();

  const payload = asRecord(input);
  const expected = asVersion(payload?.expected_version);
  if (!expected) return failure(notesError(422, "invalid_version", NOTE_MESSAGES.invalidVersion));

  const rpc = await callRpc(
    supabase,
    "convert_order_legacy_notes_v1",
    { p_order_id: orderId, p_expected_row_version: expected },
    { orderId }
  );
  if (!rpc.ok) {
    const body = asRecord(rpc.result.body);
    if (body?.code === "conflict") {
      return { status: 409, body: { ...body, error: NOTE_MESSAGES.orderConflict } };
    }
    if (body?.code === "not_found") {
      return { status: 404, body: { ...body, error: NOTE_MESSAGES.orderNotFound } };
    }
    return rpc.result;
  }
  const version = asVersion(rpc.payload.version);
  const noteId = asString(asRecord(rpc.payload.note)?.id);
  if (!version || !noteId) return failure(notesError(500, "unexpected", NOTE_MESSAGES.unexpected));
  return ok({ ok: true, version, note_id: noteId });
}
