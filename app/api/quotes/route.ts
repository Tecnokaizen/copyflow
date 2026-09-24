import { NextRequest } from "next/server";
import { operationalJson } from "@/lib/http/operational-cache";
import { requireQuotesAccess } from "@/lib/quotes/guard";
import { QUOTE_MESSAGES } from "@/lib/quotes/errors";
import { parseCreateQuotePayload } from "@/lib/quotes/payload";
import { relationBelongsToTenant } from "@/lib/quotes/relations";
import { QUOTE_SELECT, mapQuote } from "@/lib/quotes/types";
import { quoteSearchFilter } from "@/lib/quotes/workflow";

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

function pageNumber(raw: string | null, fallback: number, max?: number) {
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return fallback;
  }

  return max ? Math.min(parsed, max) : parsed;
}

function searchPattern(raw: string | null) {
  const cleaned = (raw ?? "").replace(/[%_,()]/g, " ").trim();
  if (!cleaned) {
    return null;
  }

  return `%${cleaned}%`;
}

export async function GET(request: NextRequest) {
  const access = await requireQuotesAccess();
  if (!access.ok) {
    return access.response;
  }

  const params = request.nextUrl.searchParams;
  const page = pageNumber(params.get("page"), 1);
  const pageSize = pageNumber(params.get("page_size"), DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  const statusCode = params.get("status")?.trim() || null;
  const pattern = searchPattern(params.get("q"));
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let statusId: string | null = null;
  if (statusCode) {
    const { data: status, error: statusError } = await access.supabase
      .from("quote_statuses")
      .select("id")
      .eq("tenant_id", access.context.tenant.id)
      .eq("code", statusCode)
      .eq("active", true)
      .maybeSingle();

    if (statusError) {
      return operationalJson({ error: QUOTE_MESSAGES.invalid }, { status: 500 });
    }

    if (!status) {
      return operationalJson({
        tenant: access.context.tenant.slug,
        quotes: [],
        total: 0,
        page,
        page_size: pageSize,
        total_pages: 0,
      });
    }

    statusId = status.id;
  }

  let query = access.supabase
    .from("quotes")
    .select(QUOTE_SELECT, { count: "exact" })
    .eq("tenant_id", access.context.tenant.id)
    .order("created_at", { ascending: false })
    .range(from, to);

  if (statusId) {
    query = query.eq("status_id", statusId);
  }

  if (pattern) {
    const { data: clients } = await access.supabase
      .from("clients")
      .select("id")
      .eq("tenant_id", access.context.tenant.id)
      .ilike("name", pattern)
      .limit(100);
    const clientIds = (clients ?? [])
      .map((client) => client.id)
      .filter((id): id is string => typeof id === "string");

    query = query.or(quoteSearchFilter(pattern, clientIds));
  }

  const { data, error, count } = await query;
  if (error) {
    return operationalJson({ error: "No se pudieron cargar los presupuestos" }, { status: 500 });
  }

  const total = count ?? 0;
  return operationalJson({
    tenant: access.context.tenant.slug,
    quotes: (data ?? []).map(mapQuote).filter((quote) => quote !== null),
    total,
    page,
    page_size: pageSize,
    total_pages: total === 0 ? 0 : Math.ceil(total / pageSize),
  });
}

export async function POST(request: NextRequest) {
  const access = await requireQuotesAccess();
  if (!access.ok) {
    return access.response;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return operationalJson({ error: QUOTE_MESSAGES.invalid }, { status: 400 });
  }

  const parsed = parseCreateQuotePayload(body);
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

  const { data: draft, error: draftError } = await access.supabase
    .from("quote_statuses")
    .select("id")
    .eq("tenant_id", access.context.tenant.id)
    .eq("code", "draft")
    .eq("active", true)
    .maybeSingle();

  if (draftError || !draft) {
    return operationalJson({ error: QUOTE_MESSAGES.noDraftStatus }, { status: 500 });
  }

  const { data, error } = await access.supabase
    .from("quotes")
    .insert({
      tenant_id: access.context.tenant.id,
      title: parsed.data.title,
      description: parsed.data.description,
      notes: parsed.data.notes,
      valid_until: parsed.data.valid_until,
      client_id: parsed.data.client_id,
      service_id: parsed.data.service_id,
      assigned_team_member_id: parsed.data.assigned_team_member_id,
      status_id: draft.id,
    })
    .select(QUOTE_SELECT)
    .single();

  if (error || !data) {
    return operationalJson({ error: QUOTE_MESSAGES.create }, { status: 500 });
  }

  const quote = mapQuote(data);
  if (!quote) {
    return operationalJson({ error: QUOTE_MESSAGES.create }, { status: 500 });
  }

  return operationalJson(
    { ok: true, tenant: access.context.tenant.slug, quote },
    { status: 201 }
  );
}
