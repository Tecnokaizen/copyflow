import { NextRequest } from "next/server";
import { operationalJson } from "@/lib/http/operational-cache";
import { requireQuotesAccess } from "@/lib/quotes/guard";
import { QUOTE_MESSAGES } from "@/lib/quotes/errors";
import { parseQuoteStatusPayload } from "@/lib/quotes/payload";
import { QUOTE_SELECT, mapQuote } from "@/lib/quotes/types";
import { commercialQuoteInTenant, commercialFailureBody } from "@/lib/quotes/commercial";
import { transitionFailure } from "@/lib/quotes/transition-result";
import { isUuid } from "@/lib/team/payload";

type RouteContext = {
  params: Promise<{ id: string }>;
};

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
    return operationalJson({ error: QUOTE_MESSAGES.invalid }, { status: 400 });
  }

  const parsed = parseQuoteStatusPayload(body);
  if (!parsed.ok) {
    return operationalJson({ error: parsed.error }, { status: 400 });
  }

  const scope = await commercialQuoteInTenant(access.supabase, id, access.context.tenant.id);
  if (scope) return operationalJson(commercialFailureBody(scope), { status: scope.status });
  const { data: result, error: rpcError } = await access.supabase.rpc("set_editable_quote_status_v1", {
    p_quote_id: id, p_status_id: parsed.data.status_id, p_expected_row_version: parsed.data.expected_row_version,
  });
  if (rpcError) return operationalJson({ error: QUOTE_MESSAGES.update }, { status: 500 });
  if (!result?.ok) { const failure = transitionFailure(result ?? {}); return operationalJson(failure.body, { status: failure.status }); }
  const { data, error } = await access.supabase.from("quotes").select(QUOTE_SELECT)
    .eq("id", id).eq("tenant_id", access.context.tenant.id).maybeSingle();
  if (error) return operationalJson({ error: QUOTE_MESSAGES.update }, { status: 500 });

  const quote = mapQuote(data);
  if (!quote) {
    return operationalJson({ error: QUOTE_MESSAGES.version }, { status: 409 });
  }

  return operationalJson({
    ok: true,
    tenant: access.context.tenant.slug,
    quote,
  });
}
