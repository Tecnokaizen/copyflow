import { NextRequest } from "next/server";
import { operationalJson } from "@/lib/http/operational-cache";
import { requireQuotesAccess } from "@/lib/quotes/guard";
import { QUOTE_MESSAGES } from "@/lib/quotes/errors";
import { parseUpdateQuotePayload } from "@/lib/quotes/payload";
import { relationBelongsToTenant } from "@/lib/quotes/relations";
import { QUOTE_SELECT, mapQuote } from "@/lib/quotes/types";
import { isUuid } from "@/lib/team/payload";

type RouteContext = {
  params: Promise<{ id: string }>;
};

async function loadQuote(
  access: Extract<Awaited<ReturnType<typeof requireQuotesAccess>>, { ok: true }>,
  id: string
) {
  const { data, error } = await access.supabase
    .from("quotes")
    .select(QUOTE_SELECT)
    .eq("id", id)
    .eq("tenant_id", access.context.tenant.id)
    .maybeSingle();

  if (error) {
    return { error: true as const };
  }

  return { error: false as const, quote: mapQuote(data) };
}

export async function GET(_request: NextRequest, context: RouteContext) {
  const access = await requireQuotesAccess();
  if (!access.ok) {
    return access.response;
  }

  const { id } = await context.params;
  if (!isUuid(id)) {
    return operationalJson({ error: QUOTE_MESSAGES.notFound }, { status: 404 });
  }

  const loaded = await loadQuote(access, id);
  if (loaded.error) {
    return operationalJson({ error: QUOTE_MESSAGES.notFound }, { status: 500 });
  }

  if (!loaded.quote) {
    return operationalJson({ error: QUOTE_MESSAGES.notFound }, { status: 404 });
  }

  return operationalJson({
    tenant: access.context.tenant.slug,
    quote: loaded.quote,
  });
}

export async function PATCH(request: NextRequest, context: RouteContext) {
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

  const parsed = parseUpdateQuotePayload(body);
  if (!parsed.ok) {
    return operationalJson({ error: parsed.error }, { status: 400 });
  }

  const relations: Array<{
    table: "clients" | "services" | "team_members";
    id: string | null;
  }> = [
    { table: "clients", id: parsed.data.client_id },
    { table: "services", id: parsed.data.service_id },
    { table: "team_members", id: parsed.data.assigned_team_member_id },
  ];

  for (const relation of relations) {
    if (!relation.id) {
      continue;
    }

    const ok = await relationBelongsToTenant(
      access.supabase,
      relation.table,
      relation.id,
      access.context.tenant.id
    );
    if (!ok) {
      return operationalJson({ error: QUOTE_MESSAGES.relation }, { status: 400 });
    }
  }

  const { data, error } = await access.supabase
    .from("quotes")
    .update({
      title: parsed.data.title,
      description: parsed.data.description,
      notes: parsed.data.notes,
      valid_until: parsed.data.valid_until,
      client_id: parsed.data.client_id,
      service_id: parsed.data.service_id,
      assigned_team_member_id: parsed.data.assigned_team_member_id,
    })
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
