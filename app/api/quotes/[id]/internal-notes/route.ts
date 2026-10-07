import { NextRequest } from "next/server";
import { operationalJson } from "@/lib/http/operational-cache";
import { QUOTE_MESSAGES } from "@/lib/quotes/errors";
import { requireQuotesAccess } from "@/lib/quotes/guard";
import { isUuid } from "@/lib/team/payload";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  const access = await requireQuotesAccess();
  if (!access.ok) {
    return access.response;
  }
  const { id } = await context.params;
  if (!isUuid(id)) {
    return operationalJson({ error: QUOTE_MESSAGES.notFound }, { status: 404 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return operationalJson({ error: "No se pudieron guardar las notas internas." }, { status: 422 });
  }
  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  const notes = typeof record?.notes === "string" ? record.notes : "";
  const version = typeof record?.expected_row_version === "string"
    ? record.expected_row_version
    : typeof record?.expected_row_version === "number" && Number.isSafeInteger(record.expected_row_version) && record.expected_row_version >= 0
      ? String(record.expected_row_version)
      : null;
  if (notes.length > 8000 || !version || !/^[0-9]+$/.test(version)) {
    return operationalJson({ error: "No se pudieron guardar las notas internas." }, { status: 422 });
  }
  const { data, error } = await access.supabase.rpc("update_quote_internal_notes", {
    p_quote_id: id,
    p_notes: notes,
    p_expected_row_version: version,
  });
  if (error) {
    return operationalJson({ error: "No se pudieron guardar las notas internas." }, { status: 500 });
  }
  const payload = data as { ok?: boolean; error?: string; changed?: boolean; row_version?: string; internal_notes?: string | null };
  if (!payload?.ok) {
    if (payload?.error === "conflict") {
      return operationalJson(
        { error: "El presupuesto cambió. Recarga la ficha e inténtalo de nuevo.", code: "conflict" },
        { status: 409 }
      );
    }
    return operationalJson({ error: QUOTE_MESSAGES.notFound }, { status: 404 });
  }
  return operationalJson({
    changed: payload.changed === true,
    row_version: payload.row_version,
    internal_notes: payload.internal_notes ?? null,
  });
}
