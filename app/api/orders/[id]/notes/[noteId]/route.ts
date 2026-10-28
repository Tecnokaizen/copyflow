import { NextRequest } from "next/server";
import { operationalJson } from "@/lib/http/operational-cache";
import { loadOrderNoteHistory, readNotesJson, updateOrderNote } from "@/lib/orders/notes/server";
import { createClient } from "@/lib/supabase/server";
import { requireCurrentAccess } from "@/lib/tenant/access-response";

// SUR4 E6: GET is the note's history (events with the versions before and
// after, text or «Texto suprimido»); PATCH runs update_order_note_v1 with the
// note's own row_version.
type NoteRouteContext = { params: Promise<{ id: string; noteId: string }> };

const ROUTE = "/api/orders/[id]/notes/[noteId]";

export async function GET(_request: NextRequest, { params }: NoteRouteContext) {
  const access = await requireCurrentAccess(ROUTE);
  if (!access.ok) {
    return access.response;
  }
  const { id, noteId } = await params;
  const supabase = await createClient();
  const result = await loadOrderNoteHistory(supabase, access.context, id, noteId);
  return operationalJson(result.body, { status: result.status });
}

export async function PATCH(request: NextRequest, { params }: NoteRouteContext) {
  const access = await requireCurrentAccess(ROUTE);
  if (!access.ok) {
    return access.response;
  }
  const { id, noteId } = await params;
  const supabase = await createClient();
  const result = await updateOrderNote(supabase, access.context, id, noteId, await readNotesJson(request));
  return operationalJson(result.body, { status: result.status });
}
