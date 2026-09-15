import type { SupabaseClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { canWriteOrders } from "@/lib/auth/membership-roles";
import { operationalJson } from "@/lib/http/operational-cache";
import { canAccessCounter } from "@/lib/nav/items";
import {
  filterOrdersForCounter,
  groupCounterBuckets,
  mapCounterOrderRow,
  parseCounterFilterParams,
  type CounterOrder,
} from "@/lib/orders/counter";
import { createClient } from "@/lib/supabase/server";
import { resolveCurrentTeamMember } from "@/lib/team/current-member";
import { getCurrentContext } from "@/lib/tenant/current-context";
import {
  getZonedDayBounds,
  resolveTimeZone,
} from "@/lib/time/zoned-day";

const COUNTER_SELECT = `
  id,
  tenant_id,
  reference,
  title,
  description,
  priority,
  due_at,
  delivered_at,
  ready_at,
  customer_notification_status,
  store_id,
  assigned_team_member_id,
  service_id,
  client:clients(name),
  service:services(name),
  store:stores(name),
  assigned_team_member:team_members(name),
  status:order_statuses!inner(name, is_ready, is_closed, is_cancelled)
`;

const PAGE_SIZE = 200;

async function fetchActiveCounterOrders(
  supabase: SupabaseClient,
  tenantId: string
) {
  const orders: unknown[] = [];
  let offset = 0;
  let total: number | null = null;

  while (true) {
    const { data, error, count } = await supabase
      .from("orders")
      .select(COUNTER_SELECT, { count: "exact" })
      .eq("tenant_id", tenantId)
      .is("archived_at", null)
      .is("delivered_at", null)
      .eq("status.is_closed", false)
      .eq("status.is_cancelled", false)
      .order("due_at", { ascending: true, nullsFirst: false })
      .order("reference", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) {
      return { error, orders: [] as unknown[] };
    }

    if (offset === 0 && count != null) {
      total = count;
    }

    const rows = data ?? [];
    orders.push(...rows);

    if (rows.length < PAGE_SIZE) {
      break;
    }

    if (total != null && orders.length >= total) {
      break;
    }

    offset += PAGE_SIZE;
  }

  return { error: null, orders };
}

async function resolveTenantTimeZone(
  supabase: SupabaseClient,
  tenantId: string
) {
  const { data: settings } = await supabase
    .from("tenant_settings")
    .select("timezone")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  return resolveTimeZone(
    typeof settings?.timezone === "string" ? settings.timezone : null
  );
}

export async function GET(request: NextRequest) {
  const context = await getCurrentContext();

  if (!context || !canAccessCounter(context.membership.role)) {
    return operationalJson(
      { error: "Unauthorized or tenant access denied" },
      { status: 403 }
    );
  }

  const supabase = await createClient();
  const timezone = await resolveTenantTimeZone(supabase, context.tenant.id);
  const today = getZonedDayBounds(new Date(), timezone).date;
  const filters = parseCounterFilterParams(request.nextUrl.searchParams);
  const teamMember = filters.mine
    ? await resolveCurrentTeamMember(
        supabase,
        context.tenant.id,
        context.user.id
      )
    : null;

  const result = await fetchActiveCounterOrders(
    supabase,
    context.tenant.id
  );

  if (result.error) {
    console.error("[GET /api/orders/counter] Could not load orders", {
      tenantId: context.tenant.id,
      error: result.error,
    });

    return operationalJson(
      { error: "Could not load orders" },
      { status: 500 }
    );
  }

  const mapped = result.orders
    .map((row) => mapCounterOrderRow(row))
    .filter((row): row is CounterOrder => row !== null);

  const orders = filterOrdersForCounter(mapped, {
    tenantId: context.tenant.id,
    query: filters.query,
    storeId: filters.storeId,
    assigneeId: filters.assigneeId,
    serviceId: filters.serviceId,
    priority: filters.priority,
    mine: filters.mine,
    currentTeamMemberId: teamMember?.id ?? null,
  });

  const buckets = groupCounterBuckets(orders, {
    todayCivil: today,
    timeZone: timezone,
  });

  return operationalJson({
    tenant: context.tenant.slug,
    timezone,
    today,
    query: filters.query,
    can_write: canWriteOrders(context.membership.role),
    count: orders.length,
    buckets,
  });
}
