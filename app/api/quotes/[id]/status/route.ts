import { NextRequest } from "next/server";
import { operationalJson } from "@/lib/http/operational-cache";
import { requireQuotesAccess } from "@/lib/quotes/guard";
import { QUOTE_MESSAGES } from "@/lib/quotes/errors";
import { parseQuoteStatusPayload } from "@/lib/quotes/payload";
import { relationBelongsToTenant } from "@/lib/quotes/relations";
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

  const parsed = parseQuoteStatusPayload(body);
  if (!parsed.ok) {
    return operationalJson({ error: parsed.error }, { status: 400 });
  }

  const statusOk = await relationBelongsToTenant(
    access.supabase,
    "quote_statuses",
    parsed.data.status_id,
    access.context.tenant.id
  );
  if (!statusOk) {
    return operationalJson({ error: QUOTE_MESSAGES.status }, { status: 400 });
  }

  const { data: activeStatus, error: activeError } = await access.supabase
    .from("quote_statuses")
    .select("id")
    .eq("id", parsed.data.status_id)
    .eq("tenant_id", access.context.tenant.id)
    .eq("active", true)
    .maybeSingle();

  if (activeError || !activeStatus) {
    return operationalJson({ error: QUOTE_MESSAGES.status }, { status: 400 });
  }

  const { data, error } = await access.supabase
    .from("quotes")
    .update({ status_id: parsed.data.status_id })
    .eq("id", id)
    .eq("tenant_id", access.context.tenant.id)
    .eq("row_version", parsed.data.expected_row_version)
    .select(QUOTE_SELECT)
    .maybeSingle();

  if (error) {
    return operationalJson({ error: QUOTE_MESSAGES.update }, { status: 500 });
  }

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
