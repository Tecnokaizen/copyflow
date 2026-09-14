import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getCurrentContext } from "@/lib/tenant/current-context";
import { resolveCurrentTeamMember } from "@/lib/team/current-member";
import {
  groupMyOrdersQueue,
  mapMineOrderRow,
  resolveMineQueryScope,
  type MineOrder,
} from "@/lib/orders/mine";
import {
  getZonedDayBounds,
  resolveTimeZone,
} from "@/lib/time/zoned-day";

const MINE_SELECT = `
  id,
  reference,
  title,
  priority,
  due_at,
  delivered_at,
  ready_at,
  assigned_team_member_id,
  client:clients(name),
  service:services(name),
  status:order_statuses!inner(name, code, is_ready, is_closed, is_cancelled)
`;

const PAGE_SIZE = 200;

async function fetchAssignedActiveOrders(
  supabase: SupabaseClient,
  tenantId: string,
  assignedTeamMemberId: string
) {
  const orders: unknown[] = [];
  let offset = 0;
  let total: number | null = null;

  while (true) {
    const { data, error, count } = await supabase
      .from("orders")
      .select(MINE_SELECT, { count: "exact" })
      .eq("tenant_id", tenantId)
      .eq("assigned_team_member_id", assignedTeamMemberId)
      .is("archived_at", null)
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

export async function GET() {
  const context = await getCurrentContext();

  if (!context) {
    return NextResponse.json(
      { error: "Unauthorized or tenant access denied" },
      { status: 403 }
    );
  }

  const supabase = await createClient();
  const teamMember = await resolveCurrentTeamMember(
    supabase,
    context.tenant.id,
    context.user.id
  );
  const timezone = await resolveTenantTimeZone(supabase, context.tenant.id);
  const scope = resolveMineQueryScope({
    tenantId: context.tenant.id,
    sessionTeamMemberId: teamMember?.id ?? null,
  });

  if (!scope.assignedTeamMemberId || !teamMember) {
    return NextResponse.json({
      tenant: context.tenant.slug,
      linked: false,
      team_member: null,
      timezone,
      today: getZonedDayBounds(new Date(), timezone).date,
      count: 0,
      sections: [],
      orders: [],
    });
  }

  const result = await fetchAssignedActiveOrders(
    supabase,
    scope.tenantId,
    scope.assignedTeamMemberId
  );

  if (result.error) {
    console.error("[GET /api/orders/mine] Could not load orders", {
      tenantId: context.tenant.id,
      teamMemberId: scope.assignedTeamMemberId,
      error: result.error,
    });

    return NextResponse.json(
      { error: "Could not load orders" },
      { status: 500 }
    );
  }

  const orders = result.orders
    .map((row) => mapMineOrderRow(row))
    .filter((row): row is MineOrder => row !== null);

  const sections = groupMyOrdersQueue(orders, {
    now: new Date(),
    timeZone: timezone,
    assignedTeamMemberId: scope.assignedTeamMemberId,
  });

  return NextResponse.json({
    tenant: context.tenant.slug,
    linked: true,
    team_member: teamMember,
    timezone,
    today: getZonedDayBounds(new Date(), timezone).date,
    count: orders.length,
    sections,
    orders,
  });
}
