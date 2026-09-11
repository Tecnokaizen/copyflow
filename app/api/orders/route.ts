import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentContext } from "@/lib/tenant/current-context";
import {
  OPERATIVE_ROLES,
  hasMembershipRole,
} from "@/lib/auth/membership-roles";
import { isUuid } from "@/lib/team/payload";
import { getZonedDayBounds, resolveTimeZone, getZonedWeekBoundsFromMonday, getZonedWeekMondayCivil, parseCivilDate } from "@/lib/time/zoned-day";
import type { SupabaseClient } from "@supabase/supabase-js";

const PRIORITIES = ["normal", "high", "urgent"] as const;

type Priority = (typeof PRIORITIES)[number];

const LIST_FILTERS = [
  "active",
  "urgent",
  "overdue",
  "all",
  "attention",
  "upcoming",
] as const;

type ListFilter = (typeof LIST_FILTERS)[number];

const SORT_FIELDS = [
  "reference",
  "client",
  "channel",
  "assignee",
  "status",
  "due_at",
] as const;

type SortField = (typeof SORT_FIELDS)[number];
type SortDir = "asc" | "desc";

function parseListFilter(raw: string | null): ListFilter | null {
  if (!raw) {
    return null;
  }

  return LIST_FILTERS.includes(raw as ListFilter) ? (raw as ListFilter) : null;
}

function parseSortField(raw: string | null): SortField | null {
  if (!raw) {
    return null;
  }

  return SORT_FIELDS.includes(raw as SortField) ? (raw as SortField) : null;
}

function parseSortDir(raw: string | null): SortDir | null {
  if (!raw) {
    return null;
  }

  if (raw === "asc" || raw === "desc") {
    return raw;
  }

  return null;
}

function applyListOrdering(
  // Supabase query builder; keep loose to allow relation order columns.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query: any,
  sort: SortField | null,
  dir: SortDir | null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any {
  if (!sort) {
    return query
      .order("created_at", { ascending: false })
      .order("id", { ascending: false });
  }

  const ascending = dir !== "desc";

  switch (sort) {
    case "reference":
      return query
        .order("reference", { ascending })
        .order("id", { ascending: true });
    case "client":
      return query
        .order("client(name)", { ascending, nullsFirst: false })
        .order("reference", { ascending: true });
    case "channel":
      return query
        .order("entry_channel(name)", { ascending, nullsFirst: false })
        .order("reference", { ascending: true });
    case "assignee":
      return query
        .order("assigned_team_member(name)", {
          ascending,
          nullsFirst: false,
        })
        .order("reference", { ascending: true });
    case "status":
      return query
        .order("status(sort_order)", { ascending, nullsFirst: false })
        .order("status(name)", { ascending: true })
        .order("reference", { ascending: true });
    case "due_at":
      return query
        .order("due_at", { ascending, nullsFirst: false })
        .order("reference", { ascending: true });
    default:
      return query
        .order("created_at", { ascending: false })
        .order("id", { ascending: false });
  }
}

const ORDER_SELECT = `
  *,
  client:clients(*),
  service:services(*),
  status:order_statuses(*),
  entry_channel:entry_channels(*),
  assigned_team_member:team_members(*),
  order_context:order_contexts(*),
  file_status:file_statuses(*),
  quote_status:quote_statuses(*),
  payment_status:payment_statuses(*),
  delivery_method:delivery_methods(*)
`;

function emptyToNull(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseDueAt(value: unknown): { ok: true; dueAt: string | null } | { ok: false } {
  if (value == null) {
    return { ok: true, dueAt: null };
  }

  if (typeof value !== "string") {
    return { ok: false };
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return { ok: true, dueAt: null };
  }

  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) {
    return { ok: false };
  }

  return { ok: true, dueAt: date.toISOString() };
}

async function belongsToTenant(
  supabase: SupabaseClient,
  table: string,
  id: string,
  tenantId: string
) {
  const { data, error } = await supabase
    .from(table)
    .select("id")
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  return !error && Boolean(data);
}

function parseTimestamp(
  raw: string | null
): { ok: true; value: string | null } | { ok: false } {
  if (!raw || !raw.trim()) {
    return { ok: true, value: null };
  }

  const date = new Date(raw.trim());
  if (Number.isNaN(date.getTime())) {
    return { ok: false };
  }

  return { ok: true, value: date.toISOString() };
}

const DUE_AT_RANGE_CHUNK = 500;

const ORDER_SELECT_ACTIVE = ORDER_SELECT.replace(
  "status:order_statuses(*)",
  "status:order_statuses!inner(*)"
);

type CalendarRangeFilter = "active" | "all";

async function fetchOrdersByDueAtRange(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tenantId: string,
  fromValue: string | null,
  toValue: string | null,
  options?: {
    filter?: CalendarRangeFilter | null;
    assignedTeamMemberId?: string | null;
  }
) {
  const orders = [];
  let total: number | null = null;
  let offset = 0;
  const activeOnly = options?.filter === "active";
  const select = activeOnly ? ORDER_SELECT_ACTIVE : ORDER_SELECT;

  while (true) {
    let query = supabase
      .from("orders")
      .select(select, { count: "exact" })
      .eq("tenant_id", tenantId)
      .not("due_at", "is", null);

    if (fromValue) {
      query = query.gte("due_at", fromValue);
    }

    if (toValue) {
      query = query.lt("due_at", toValue);
    }

    if (activeOnly) {
      query = query
        .is("archived_at", null)
        .eq("status.is_closed", false)
        .eq("status.is_cancelled", false);
    }

    if (options?.assignedTeamMemberId) {
      query = query.eq(
        "assigned_team_member_id",
        options.assignedTeamMemberId
      );
    }

    const { data, error, count } = await query
      .order("due_at", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + DUE_AT_RANGE_CHUNK - 1);

    if (error) {
      return { error };
    }

    if (offset === 0 && count != null) {
      total = count;
    }

    const rows = data ?? [];
    orders.push(...rows);

    if (rows.length < DUE_AT_RANGE_CHUNK) {
      break;
    }

    if (total != null && orders.length >= total) {
      break;
    }

    offset += DUE_AT_RANGE_CHUNK;
  }

  return {
    error: null,
    orders,
    total: total ?? orders.length,
  };
}

async function fetchActiveOrders(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tenantId: string
) {
  const orders = [];
  let total: number | null = null;
  let offset = 0;

  while (true) {
    const { data, error, count } = await supabase
      .from("orders")
      .select(ORDER_SELECT_ACTIVE, { count: "exact" })
      .eq("tenant_id", tenantId)
      .is("archived_at", null)
      .eq("status.is_closed", false)
      .eq("status.is_cancelled", false)
      .order("service_id", { ascending: true, nullsFirst: false })
      .order("due_at", { ascending: true, nullsFirst: false })
      .order("id", { ascending: true })
      .range(offset, offset + DUE_AT_RANGE_CHUNK - 1);

    if (error) {
      return { error };
    }

    if (offset === 0 && count != null) {
      total = count;
    }

    const rows = data ?? [];
    orders.push(...rows);

    if (rows.length < DUE_AT_RANGE_CHUNK) {
      break;
    }

    if (total != null && orders.length >= total) {
      break;
    }

    offset += DUE_AT_RANGE_CHUNK;
  }

  return {
    error: null,
    orders,
    total: total ?? orders.length,
  };
}

async function countAllOrders(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tenantId: string
) {
  const { count, error } = await supabase
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId);

  if (error) {
    return { error, total: 0 };
  }

  return { error: null, total: count ?? 0 };
}

async function resolveUpcomingCutoffIso(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tenantId: string
) {
  const { data: settings } = await supabase
    .from("tenant_settings")
    .select("timezone")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  const timezone = resolveTimeZone(
    typeof settings?.timezone === "string" ? settings.timezone : null
  );
  const day = getZonedDayBounds(new Date(), timezone);
  return day.end.toISOString();
}

export async function GET(request: NextRequest) {
  const context = await getCurrentContext();

  if (!context) {
    return NextResponse.json(
      { error: "Unauthorized or tenant access denied" },
      { status: 403 }
    );
  }

  const { searchParams } = new URL(request.url);

  const fromDate = parseTimestamp(searchParams.get("from"));
  const toDate = parseTimestamp(searchParams.get("to"));
  const weekStartRaw = searchParams.get("week_start")?.trim() || null;

  if (!fromDate.ok || !toDate.ok) {
    return NextResponse.json(
      { error: "Invalid value" },
      { status: 400 }
    );
  }

  if (
    fromDate.value &&
    toDate.value &&
    fromDate.value > toDate.value
  ) {
    return NextResponse.json(
      { error: "Invalid value" },
      { status: 400 }
    );
  }

  const rawPage = Number.parseInt(searchParams.get("page") ?? "1", 10);
  const rawPageSize = Number.parseInt(
    searchParams.get("page_size") ?? "50",
    10
  );

  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;

  const pageSize =
    Number.isFinite(rawPageSize) && rawPageSize > 0
      ? Math.min(rawPageSize, 100)
      : 50;

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  const activeOnly = searchParams.get("active") === "true";
  const rawFilter = searchParams.get("filter");
  const listFilter = parseListFilter(rawFilter);
  const assignedTeamMemberIdRaw = searchParams.get("assigned_team_member_id");
  const assignedTeamMemberId = assignedTeamMemberIdRaw?.trim() || null;
  const statusIdRaw = searchParams.get("status_id");
  const statusId = statusIdRaw?.trim() || null;
  const rawSort = searchParams.get("sort");
  const rawDir = searchParams.get("dir");
  const sortField = parseSortField(rawSort);
  const sortDir = parseSortDir(rawDir);

  if (rawFilter && !listFilter) {
    return NextResponse.json({ error: "Invalid value" }, { status: 400 });
  }

  if (assignedTeamMemberId && !isUuid(assignedTeamMemberId)) {
    return NextResponse.json({ error: "Invalid value" }, { status: 400 });
  }

  if (statusId && !isUuid(statusId)) {
    return NextResponse.json({ error: "Invalid value" }, { status: 400 });
  }

  if (rawSort && !sortField) {
    return NextResponse.json({ error: "Invalid value" }, { status: 400 });
  }

  if (rawDir && !sortDir) {
    return NextResponse.json({ error: "Invalid value" }, { status: 400 });
  }

  if (sortField && !sortDir) {
    return NextResponse.json({ error: "Invalid value" }, { status: 400 });
  }

  if (sortDir && !sortField) {
    return NextResponse.json({ error: "Invalid value" }, { status: 400 });
  }

  const supabase = await createClient();

  let rangeFrom = fromDate.value;
  let rangeTo = toDate.value;
  let weekMeta: {
    timezone: string;
    week_start: string;
    week_days: string[];
  } | null = null;

  if (weekStartRaw) {
    const { data: settings } = await supabase
      .from("tenant_settings")
      .select("timezone")
      .eq("tenant_id", context.tenant.id)
      .maybeSingle();

    const timezone = resolveTimeZone(
      typeof settings?.timezone === "string" ? settings.timezone : null
    );

    let mondayCivil: string | null = null;
    if (weekStartRaw === "current") {
      mondayCivil = getZonedWeekMondayCivil(new Date(), timezone);
    } else {
      const parsedMonday = parseCivilDate(weekStartRaw);
      mondayCivil = parsedMonday.ok ? parsedMonday.date : null;
    }

    if (!mondayCivil) {
      return NextResponse.json({ error: "Invalid value" }, { status: 400 });
    }

    const bounds = getZonedWeekBoundsFromMonday(mondayCivil, timezone);
    if (!bounds) {
      return NextResponse.json({ error: "Invalid value" }, { status: 400 });
    }

    rangeFrom = bounds.start.toISOString();
    rangeTo = bounds.end.toISOString();
    weekMeta = {
      timezone,
      week_start: bounds.monday,
      week_days: bounds.days,
    };
  }

  const dateFiltered = Boolean(rangeFrom || rangeTo);

  // Dashboard deep link with only assignee → operative (active) scope.
  const effectiveFilter: ListFilter | null =
    listFilter ?? (assignedTeamMemberId || statusId ? "active" : null);

  if (statusId) {
    const statusOk = await belongsToTenant(
      supabase,
      "order_statuses",
      statusId,
      context.tenant.id
    );

    if (!statusOk) {
      return NextResponse.json(
        { error: "Invalid related record for current tenant" },
        { status: 400 }
      );
    }
  }

  if (dateFiltered) {
    if (rawFilter && rawFilter !== "active" && rawFilter !== "all") {
      return NextResponse.json({ error: "Invalid value" }, { status: 400 });
    }

    const calendarFilter: CalendarRangeFilter | null =
      rawFilter === "active" || rawFilter === "all" ? rawFilter : null;

    if (assignedTeamMemberId) {
      const assigneeOk = await belongsToTenant(
        supabase,
        "team_members",
        assignedTeamMemberId,
        context.tenant.id
      );

      if (!assigneeOk) {
        return NextResponse.json(
          { error: "Invalid related record for current tenant" },
          { status: 400 }
        );
      }
    }

    const result = await fetchOrdersByDueAtRange(
      supabase,
      context.tenant.id,
      rangeFrom,
      rangeTo,
      {
        filter: calendarFilter,
        assignedTeamMemberId,
      }
    );

    if (result.error) {
      console.error("[GET /api/orders] Could not load orders", {
        tenantId: context.tenant.id,
        error: result.error,
      });

      return NextResponse.json(
        { error: "Could not load orders" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      tenant: context.tenant.slug,
      count: result.orders.length,
      total: result.total,
      page: 1,
      page_size: result.orders.length,
      orders: result.orders,
      ...(weekMeta
        ? {
            timezone: weekMeta.timezone,
            week_start: weekMeta.week_start,
            week_days: weekMeta.week_days,
            from: rangeFrom,
            to: rangeTo,
          }
        : {}),
    });
  }

  if (activeOnly) {
    const result = await fetchActiveOrders(supabase, context.tenant.id);

    if (result.error) {
      console.error("[GET /api/orders] Could not load orders", {
        tenantId: context.tenant.id,
        error: result.error,
      });

      return NextResponse.json(
        { error: "Could not load orders" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      tenant: context.tenant.slug,
      count: result.orders.length,
      total: result.total,
      page: 1,
      page_size: result.orders.length,
      orders: result.orders,
    });
  }

  const needsStatusInner =
    effectiveFilter === "active" ||
    effectiveFilter === "urgent" ||
    effectiveFilter === "overdue" ||
    effectiveFilter === "attention" ||
    effectiveFilter === "upcoming";

  const select = needsStatusInner ? ORDER_SELECT_ACTIVE : ORDER_SELECT;

  let query = supabase
    .from("orders")
    .select(select, { count: "exact" })
    .eq("tenant_id", context.tenant.id);

  if (needsStatusInner) {
    query = query
      .is("archived_at", null)
      .eq("status.is_closed", false)
      .eq("status.is_cancelled", false);
  }

  if (effectiveFilter === "urgent") {
    query = query.eq("priority", "urgent");
  }

  if (effectiveFilter === "overdue") {
    query = query
      .not("due_at", "is", null)
      .lt("due_at", new Date().toISOString());
  }

  if (effectiveFilter === "attention") {
    query = query.eq("status.is_ready", true);
  }

  if (effectiveFilter === "upcoming") {
    const upcomingCutoff = await resolveUpcomingCutoffIso(
      supabase,
      context.tenant.id
    );
    query = query.gte("due_at", upcomingCutoff);
  }

  if (assignedTeamMemberId) {
    query = query.eq("assigned_team_member_id", assignedTeamMemberId);
  }

  if (statusId) {
    query = query.eq("status_id", statusId);
  }

  const {
    data: orders,
    error,
    count: total,
  } = await applyListOrdering(query, sortField, sortDir).range(from, to);

  if (error) {
    console.error("[GET /api/orders] Could not load orders", {
      tenantId: context.tenant.id,
      error,
    });

    return NextResponse.json(
      { error: "Could not load orders" },
      { status: 500 }
    );
  }

  const allTotalResult = await countAllOrders(supabase, context.tenant.id);

  if (allTotalResult.error) {
    console.error("[GET /api/orders] Could not count all orders", {
      tenantId: context.tenant.id,
      error: allTotalResult.error,
    });

    return NextResponse.json(
      { error: "Could not load orders" },
      { status: 500 }
    );
  }

  return NextResponse.json({
    tenant: context.tenant.slug,
    count: orders?.length ?? 0,
    total: total ?? 0,
    all_total: allTotalResult.total,
    page,
    page_size: pageSize,
    orders: orders ?? [],
  });
}

export async function POST(request: NextRequest) {
  const context = await getCurrentContext();

  if (!context) {
    return NextResponse.json(
      { error: "Unauthorized or tenant access denied" },
      { status: 403 }
    );
  }

  if (!hasMembershipRole(context.membership.role, OPERATIVE_ROLES)) {
    return NextResponse.json(
      { error: "Unauthorized or tenant access denied" },
      { status: 403 }
    );
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const payload = body as Record<string, unknown>;
  const title =
    typeof payload.title === "string" ? payload.title.trim() : "";

  if (!title) {
    return NextResponse.json(
      { error: "title is required" },
      { status: 400 }
    );
  }

  const priorityValue = emptyToNull(payload.priority) ?? "normal";

  if (!PRIORITIES.includes(priorityValue as Priority)) {
    return NextResponse.json(
      { error: "Invalid priority" },
      { status: 400 }
    );
  }

  const priority = priorityValue as Priority;
  const dueAtResult = parseDueAt(payload.due_at);

  if (!dueAtResult.ok) {
    return NextResponse.json(
      { error: "Invalid due_at" },
      { status: 400 }
    );
  }

  const clientId = emptyToNull(payload.client_id);
  const serviceId = emptyToNull(payload.service_id);
  const entryChannelId = emptyToNull(payload.entry_channel_id);
  const orderContextId = emptyToNull(payload.order_context_id);
  const assignedTeamMemberId = emptyToNull(payload.assigned_team_member_id);
  const description = emptyToNull(payload.description);
  const notes = emptyToNull(payload.notes);

  const supabase = await createClient();
  const tenantId = context.tenant.id;

  const relationChecks: Array<{ table: string; id: string | null }> = [
    { table: "clients", id: clientId },
    { table: "services", id: serviceId },
    { table: "entry_channels", id: entryChannelId },
    { table: "order_contexts", id: orderContextId },
    { table: "team_members", id: assignedTeamMemberId },
  ];

  for (const relation of relationChecks) {
    if (!relation.id) {
      continue;
    }

    const ok = await belongsToTenant(
      supabase,
      relation.table,
      relation.id,
      tenantId
    );

    if (!ok) {
      return NextResponse.json(
        { error: "Invalid related record for current tenant" },
        { status: 400 }
      );
    }
  }

  const { data: initialStatuses, error: initialStatusError } = await supabase
    .from("order_statuses")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("active", true)
    .eq("is_initial", true)
    .limit(2);

  if (
    initialStatusError ||
    !initialStatuses ||
    initialStatuses.length !== 1
  ) {
    return NextResponse.json(
      { error: "Tenant has no initial order status configured" },
      { status: 500 }
    );
  }

  const { data: order, error: insertError } = await supabase
    .from("orders")
    .insert({
      tenant_id: tenantId,
      title,
      description,
      client_id: clientId,
      service_id: serviceId,
      assigned_team_member_id: assignedTeamMemberId,
      status_id: initialStatuses[0].id,
      entry_channel_id: entryChannelId,
      order_context_id: orderContextId,
      priority,
      due_at: dueAtResult.dueAt,
      notes,
      created_by: context.user.id,
    })
    .select(ORDER_SELECT)
    .single();

  if (insertError || !order) {
    return NextResponse.json(
      { error: "Could not create order" },
      { status: 500 }
    );
  }

  return NextResponse.json(
    {
      ok: true,
      tenant: context.tenant.slug,
      order,
    },
    { status: 201 }
  );
}
