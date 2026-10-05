import { NextRequest } from "next/server";
import { operationalJson } from "@/lib/http/operational-cache";
import {
  commercialFailureBody,
  commercialQuoteInTenant,
  interpretCommercialDatabaseError,
  interpretCommercialRpcResult,
} from "@/lib/quotes/commercial";
import { QUOTE_MESSAGES } from "@/lib/quotes/errors";
import { requireQuotesAccess } from "@/lib/quotes/guard";
import { parseQuotePreparePayload } from "@/lib/quotes/payload";
import { QUOTE_SELECT, mapQuote } from "@/lib/quotes/types";
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

  const parsed = parseQuotePreparePayload(body);
  if (!parsed.ok) {
    return operationalJson({ error: parsed.error }, { status: 400 });
  }

  const scopeFailure = await commercialQuoteInTenant(
    access.supabase, id, access.context.tenant.id
  );
  if (scopeFailure) {
    return operationalJson(commercialFailureBody(scopeFailure), { status: scopeFailure.status });
  }

  const { data, error } = await access.supabase.rpc("prepare_quote_version_v1", {
    p_quote_id: id,
    p_version_id: parsed.data.version_id,
    p_expected_row_version: parsed.data.expected_row_version,
  });
  if (error) {
    const failure = interpretCommercialDatabaseError(error, QUOTE_MESSAGES.prepare);
    return operationalJson(commercialFailureBody(failure), { status: failure.status });
  }

  const result = interpretCommercialRpcResult(
    (data ?? {}) as {
      ok?: boolean;
      error?: string;
      row_version?: unknown;
      version?: unknown;
    }
  );
  if (!result.ok) {
    return operationalJson(commercialFailureBody(result), { status: result.status });
  }

  const { data: quoteData, error: quoteError } = await access.supabase
    .from("quotes")
    .select(QUOTE_SELECT)
    .eq("tenant_id", access.context.tenant.id)
    .eq("id", id)
    .maybeSingle();
  const quote = mapQuote(quoteData);
  if (quoteError || !quote) {
    return operationalJson({ error: QUOTE_MESSAGES.prepare }, { status: 500 });
  }

  return operationalJson({
    ok: true,
    tenant: access.context.tenant.slug,
    quote,
    prepared_version: result.version,
    totals: {
      subtotal: result.version.subtotal,
      tax_total: result.version.tax_total,
      total: result.version.total,
      currency: result.version.currency,
    },
  });
}
