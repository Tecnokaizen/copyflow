import { NextRequest } from "next/server";
import { operationalJson } from "@/lib/http/operational-cache";
import { convertLegacyOrderNotes, readNotesJson } from "@/lib/orders/notes/server";
import { createClient } from "@/lib/supabase/server";
import { requireCurrentAccess } from "@/lib/tenant/access-response";

// SUR4 E6: «Pasar a post-it». Needs the order's current version and answers
// with the new one (convert_order_legacy_notes_v1 empties orders.notes).
type NotesRouteContext = { params: Promise<{ id: string }> };

const ROUTE = "/api/orders/[id]/notes/convert-legacy";

export async function POST(request: NextRequest, { params }: NotesRouteContext) {
  const access = await requireCurrentAccess(ROUTE);
  if (!access.ok) {
    return access.response;
  }
  const { id } = await params;
  const supabase = await createClient();
  const result = await convertLegacyOrderNotes(supabase, access.context, id, await readNotesJson(request));
  return operationalJson(result.body, { status: result.status });
}
