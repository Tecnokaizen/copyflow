import { NextRequest } from "next/server";
import { operationalJson } from "@/lib/http/operational-cache";
import { createOrderNote, listOrderNotes, readNotesJson } from "@/lib/orders/notes/server";
import { createClient } from "@/lib/supabase/server";
import { requireCurrentAccess } from "@/lib/tenant/access-response";

// SUR4 E6 (contract §9): post-its of an order. GET reads with RLS
// (`?voided=1` adds the voided ones); POST runs create_order_note_v1.
type NotesRouteContext = { params: Promise<{ id: string }> };

const ROUTE = "/api/orders/[id]/notes";

export async function GET(request: NextRequest, { params }: NotesRouteContext) {
  const access = await requireCurrentAccess(ROUTE);
  if (!access.ok) {
    return access.response;
  }
  const { id } = await params;
  const supabase = await createClient();
  const includeVoided = new URL(request.url).searchParams.get("voided") === "1";
  const result = await listOrderNotes(supabase, access.context, id, includeVoided);
  return operationalJson(result.body, { status: result.status });
}

export async function POST(request: NextRequest, { params }: NotesRouteContext) {
  const access = await requireCurrentAccess(ROUTE);
  if (!access.ok) {
    return access.response;
  }
  const { id } = await params;
  const supabase = await createClient();
  const result = await createOrderNote(supabase, access.context, id, await readNotesJson(request));
  return operationalJson(result.body, { status: result.status });
}
