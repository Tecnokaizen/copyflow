import { NextRequest } from "next/server";
import { operationalJson } from "@/lib/http/operational-cache";
import { readNotesJson, setOrderNoteState } from "@/lib/orders/notes/server";
import { createClient } from "@/lib/supabase/server";
import { requireCurrentAccess } from "@/lib/tenant/access-response";

// SUR4 E6: pin, unpin, resolve, reopen and void (with reason) through
// set_order_note_state_v1. Repeating an action changes nothing.
type NoteRouteContext = { params: Promise<{ id: string; noteId: string }> };

const ROUTE = "/api/orders/[id]/notes/[noteId]/state";

export async function POST(request: NextRequest, { params }: NoteRouteContext) {
  const access = await requireCurrentAccess(ROUTE);
  if (!access.ok) {
    return access.response;
  }
  const { id, noteId } = await params;
  const supabase = await createClient();
  const result = await setOrderNoteState(supabase, access.context, id, noteId, await readNotesJson(request));
  return operationalJson(result.body, { status: result.status });
}
