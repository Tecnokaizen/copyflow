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
import { parseQuoteDraftPayload } from "@/lib/quotes/payload";
import { isUuid } from "@/lib/team/payload";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(_request: NextRequest, context: RouteContext) {
  const access = await requireQuotesAccess();
  if (!access.ok) {
    return access.response;
  }

  const { id } = await context.params;
  if (!isUuid(id)) {
    return operationalJson({ error: QUOTE_MESSAGES.notFound }, { status: 404 });
  }

  const scopeFailure = await commercialQuoteInTenant(
    access.supabase, id, access.context.tenant.id
  );
  if (scopeFailure) {
    return operationalJson(commercialFailureBody(scopeFailure), { status: scopeFailure.status });
  }

  const { data, error } = await access.supabase.rpc("ensure_quote_draft_v1", {
    p_quote_id: id,
  });
  if (error) {
    const failure = interpretCommercialDatabaseError(error, QUOTE_MESSAGES.draft);
    return operationalJson(commercialFailureBody(failure), { status: failure.status });
  }

  const result = interpretCommercialRpcResult(
    (data ?? {}) as { ok?: boolean; error?: string; version?: unknown; created?: boolean }
  );
  if (!result.ok) {
    return operationalJson(commercialFailureBody(result), { status: result.status });
  }

  return operationalJson(
    {
      ok: true,
      tenant: access.context.tenant.slug,
      created: result.created,
      replayed: !result.created,
      version: result.version,
    },
    { status: result.created ? 201 : 200 }
  );
}

export async function PUT(request: NextRequest, context: RouteContext) {
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

  const parsed = parseQuoteDraftPayload(body);
  if (!parsed.ok) {
    return operationalJson({ error: parsed.error }, { status: 400 });
  }

  const scopeFailure = await commercialQuoteInTenant(
    access.supabase, id, access.context.tenant.id
  );
  if (scopeFailure) {
    return operationalJson(commercialFailureBody(scopeFailure), { status: scopeFailure.status });
  }

  const { data, error } = await access.supabase.rpc("save_quote_draft_v1", {
    p_quote_id: id,
    p_version_id: parsed.data.version_id,
    p_expected_row_version: parsed.data.expected_row_version,
    p_header: parsed.data.header,
    p_items: parsed.data.items,
  });
  if (error) {
    const failure = interpretCommercialDatabaseError(error, QUOTE_MESSAGES.draft);
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

  return operationalJson({
    ok: true,
    tenant: access.context.tenant.slug,
    version: result.version,
    totals: {
      subtotal: result.version.subtotal,
      tax_total: result.version.tax_total,
      total: result.version.total,
      currency: result.version.currency,
    },
  });
}
