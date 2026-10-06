import { NextRequest } from "next/server";
import { operationalJson } from "@/lib/http/operational-cache";
import { requireQuotesAccess } from "@/lib/quotes/guard";
import { parseQuoteCreationPayload } from "@/lib/quotes/payload";
import { commercialFailureBody, interpretCommercialDatabaseError, interpretCommercialRpcResult } from "@/lib/quotes/commercial";
import { QUOTE_MESSAGES } from "@/lib/quotes/errors";

export async function POST(request: NextRequest) {
  const access = await requireQuotesAccess();
  if (!access.ok) return access.response;
  let body: unknown;
  try { body = await request.json(); } catch { return operationalJson({ error: QUOTE_MESSAGES.invalid }, { status: 400 }); }
  const parsed = parseQuoteCreationPayload(body);
  if (!parsed.ok) return operationalJson({ error: parsed.error }, { status: 400 });
  const p = parsed.data;
  const { data, error } = await access.supabase.rpc("create_quote_draft_v1", {
    p_tenant_id: access.context.tenant.id, p_creation_id: p.creation_id,
    p_client_id: p.client_id, p_service_id: p.service_id, p_assignee_id: p.assigned_team_member_id,
    p_header: p.header, p_items: p.items, p_prepare: p.prepare,
  });
  if (error) {
    const failure = interpretCommercialDatabaseError(error, QUOTE_MESSAGES.create);
    return operationalJson(commercialFailureBody(failure), { status: failure.status });
  }
  if (data?.error === "creation_conflict") return operationalJson({ code: "creation_conflict",
    error: "Esta operación de creación no coincide con la solicitud original. No se ha creado otro presupuesto." }, { status: 409 });
  const result = interpretCommercialRpcResult(data ?? {});
  if (!result.ok) return operationalJson(commercialFailureBody(result), { status: result.status });
  if (data.quote_id !== p.creation_id) return operationalJson({ error: QUOTE_MESSAGES.create }, { status: 500 });
  return operationalJson({ ok: true, quote_id: data.quote_id, version: result.version });
}
