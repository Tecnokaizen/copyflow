import { NextRequest } from "next/server";
import { operationalJson } from "@/lib/http/operational-cache";
import { readNotesJson, redactOrderNote } from "@/lib/orders/notes/server";
import { createClient } from "@/lib/supabase/server";
import { requireCurrentAccess } from "@/lib/tenant/access-response";

// SUR4 E6 (N22): owner only. Other roles get 403 before the RPC; the RPC
// checks the role, the feature and the tenant again.
type NoteRouteContext = { params: Promise<{ id: string; noteId: string }> };

const ROUTE = "/api/orders/[id]/notes/[noteId]/redact";

export async function POST(request: NextRequest, { params }: NoteRouteContext) {
  const access = await requireCurrentAccess(ROUTE);
  if (!access.ok) {
    return access.response;
  }
  const { id, noteId } = await params;
  const supabase = await createClient();
  const result = await redactOrderNote(supabase, access.context, id, noteId, await readNotesJson(request));
  return operationalJson(result.body, { status: result.status });
}
