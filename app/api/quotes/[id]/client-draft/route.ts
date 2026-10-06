import { NextRequest } from "next/server";
import { operationalJson } from "@/lib/http/operational-cache";
import { requireQuotesAccess } from "@/lib/quotes/guard";
import { commercialFailureBody, commercialQuoteInTenant, interpretCommercialDatabaseError, interpretCommercialRpcResult } from "@/lib/quotes/commercial";
import { QUOTE_MESSAGES } from "@/lib/quotes/errors";
import { parseQuoteDraftPayload, parseOperationalQuotePayload } from "@/lib/quotes/payload";
import { isUuid } from "@/lib/team/payload";
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const access = await requireQuotesAccess();
  if (!access.ok) return access.response;
  const { id } = await context.params;
  if (!isUuid(id)) return operationalJson({ error: QUOTE_MESSAGES.notFound }, { status: 404 });
  let body;
  try { body = await request.json(); } catch { return operationalJson({ error: QUOTE_MESSAGES.invalid }, { status: 400 }); }
  const draft = parseQuoteDraftPayload(body?.draft), fields = parseOperationalQuotePayload(body?.fields);
  if (!draft.ok || !fields.ok) return operationalJson({ error: QUOTE_MESSAGES.invalid }, { status: 400 });
  const scope = await commercialQuoteInTenant(access.supabase, id, access.context.tenant.id);
  if (scope) return operationalJson(commercialFailureBody(scope), { status: scope.status });
  const { data, error } = await access.supabase.rpc('change_quote_draft_client_v1', {
    p_quote_id: id, p_expected_quote_row_version: fields.data.expected_row_version,
    p_client_id: fields.data.client_id, p_service_id: fields.data.service_id, p_assignee_id: fields.data.assigned_team_member_id,
    p_version_id: draft.data.version_id, p_expected_version_row_version: draft.data.expected_row_version,
    p_header: draft.data.header, p_items: draft.data.items,
  });
  const result = error ? interpretCommercialDatabaseError(error, QUOTE_MESSAGES.update) : interpretCommercialRpcResult(data ?? {});
  if (!result.ok) return operationalJson(commercialFailureBody(result), { status: result.status });
  return operationalJson({ ok: true, version: result.version });
}
