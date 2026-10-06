import { transitionFailure } from "@/lib/quotes/transition-result";
import { NextRequest } from "next/server";
import { operationalJson } from "@/lib/http/operational-cache";
import { requireQuotesAccess } from "@/lib/quotes/guard";
import { commercialQuoteInTenant, commercialFailureBody, interpretCommercialDatabaseError } from "@/lib/quotes/commercial";
import { QUOTE_MESSAGES } from "@/lib/quotes/errors";
import { QUOTE_SELECT, mapQuote, mapQuoteVersion } from "@/lib/quotes/types";
import { isUuid } from "@/lib/team/payload";

export async function transitionQuote(request: NextRequest, context: { params: Promise<{ id: string }> }, action: "send" | "accept" | "reject") {
  const access = await requireQuotesAccess();
  if (!access.ok) return access.response;
  const { id } = await context.params;
  if (!isUuid(id)) return operationalJson({ error: QUOTE_MESSAGES.notFound }, { status: 404 });
  const scope = await commercialQuoteInTenant(access.supabase, id, access.context.tenant.id);
  if (scope) return operationalJson(commercialFailureBody(scope), { status: scope.status });
  let body;
  try { body = await request.json(); } catch { return operationalJson({ error: QUOTE_MESSAGES.invalid }, { status: 400 }); }
  if (!body || !isUuid(body.version_id) || !Number.isSafeInteger(body.expected_row_version) || body.expected_row_version < 0) {
    return operationalJson({ error: QUOTE_MESSAGES.invalid }, { status: 422 });
  }
  const { data, error } = await access.supabase.rpc("transition_quote_v1", {
    p_quote_id: id, p_version_id: body.version_id, p_expected_row_version: body.expected_row_version, p_action: action,
  });
  if (error) {
    const failure = interpretCommercialDatabaseError(error, QUOTE_MESSAGES.update);
    return operationalJson(commercialFailureBody(failure), { status: failure.status });
  }
  if (!data?.ok) { const failure = transitionFailure(data ?? {}); return operationalJson(failure.body, { status: failure.status }); }
  const { data: row, error: readError } = await access.supabase.from("quotes").select(QUOTE_SELECT)
    .eq("id", id).eq("tenant_id", access.context.tenant.id).maybeSingle();
  const quote = mapQuote(row); const version = mapQuoteVersion(data.version);
  if (readError || !quote || !version) return operationalJson({ error: QUOTE_MESSAGES.update }, { status: 500 });
  return operationalJson({ ok: true, quote, current_version: version, accepted_version_id: quote.accepted_version_id, replayed: data.replayed === true });
}
