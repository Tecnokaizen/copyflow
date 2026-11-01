import type { SupabaseClient } from "@supabase/supabase-js";
import { operationalJson } from "@/lib/http/operational-cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentContext } from "@/lib/tenant/current-context";
import { resolveCurrentTeamMember } from "@/lib/team/current-member";
import {
  groupMyOrdersQueue,
  mapMineOrderRow,
  resolveMineQueryScope,
  type MineOrder,
} from "@/lib/orders/mine";
import { applyOperationalOrdersFilter } from "@/lib/orders/operational";
import {
  bucketMineTurnOrders,
  loadWorkSequenceEnabled,
  mergeRowsById,
  mineTurnFlags,
  MY_PENDING_STEPS_ALIAS,
  semiJoinEmbed,
  summarizeWorkSteps,
  withWorkTurnSelect,
  type MineTurnOrder,
} from "@/lib/orders/work-turn";
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
  archived_at,
  ready_at,
  assigned_team_member_id,
  client:clients(name),
  service:services(name),
  store:stores(name),
  status:order_statuses!inner(name, code, is_ready, is_closed, is_cancelled)
`;

const PAGE_SIZE = 200;

// SUR4 E9: with the work sequence, each order carries its steps, and a second
// query brings the orders where I have a pending step (semi-join, one row per
// order). Without it, only the first query runs, exactly as before.
const MINE_TURN_SELECT = withWorkTurnSelect(MINE_SELECT);
const MINE_STEPS_SELECT = `${MINE_TURN_SELECT},\n  ${semiJoinEmbed(MY_PENDING_STEPS_ALIAS)}`;

type MineQueryMode =
  | { kind: "responsible"; select: string }
  | { kind: "pending_step"; select: string };

async function fetchAssignedActiveOrders(
  supabase: SupabaseClient,
  tenantId: string,
  assignedTeamMemberId: string,
  mode: MineQueryMode = { kind: "responsible", select: MINE_SELECT }
) {
  const orders: unknown[] = [];
  let offset = 0;
  let total: number | null = null;

  while (true) {
    const base = supabase
      .from("orders")
      .select(mode.select, { count: "exact" })
      .eq("tenant_id", tenantId);
    const scoped =
      mode.kind === "responsible"
        ? base.eq("assigned_team_member_id", assignedTeamMemberId)
        : base
            .eq(`${MY_PENDING_STEPS_ALIAS}.team_member_id`, assignedTeamMemberId)
            .is(`${MY_PENDING_STEPS_ALIAS}.completed_at`, null);
    const { data, error, count } = await applyOperationalOrdersFilter(scoped)
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
    return operationalJson(
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
    return operationalJson({
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

  const workSequence = await loadWorkSequenceEnabled(supabase, scope.tenantId);

  if (workSequence) {
    return mineWithWorkSequence({
      supabase,
      tenantSlug: context.tenant.slug,
      tenantId: scope.tenantId,
      teamMember,
      teamMemberId: scope.assignedTeamMemberId,
      timezone,
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

    return operationalJson(
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

  return operationalJson({
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

async function mineWithWorkSequence(input: {
  supabase: SupabaseClient;
  tenantSlug: string;
  tenantId: string;
  teamMember: NonNullable<Awaited<ReturnType<typeof resolveCurrentTeamMember>>>;
  teamMemberId: string;
  timezone: string;
}) {
  const [responsible, pendingStep] = await Promise.all([
    fetchAssignedActiveOrders(input.supabase, input.tenantId, input.teamMemberId, {
      kind: "responsible",
      select: MINE_TURN_SELECT,
    }),
    fetchAssignedActiveOrders(input.supabase, input.tenantId, input.teamMemberId, {
      kind: "pending_step",
      select: MINE_STEPS_SELECT,
    }),
  ]);

  const failed = responsible.error ?? pendingStep.error;
  if (failed) {
    console.error("[GET /api/orders/mine] Could not load orders", {
      tenantId: input.tenantId,
      teamMemberId: input.teamMemberId,
      error: failed,
    });

    return operationalJson(
      { error: "Could not load orders" },
      { status: 500 }
    );
  }

  const now = new Date();
  const orders = mergeRowsById(responsible.orders, pendingStep.orders).flatMap(
    (row): MineTurnOrder[] => {
      const order = mapMineOrderRow(row);
      if (!order) {
        return [];
      }
      const summary = summarizeWorkSteps(
        (row as { work_steps?: unknown }).work_steps
      );
      return [
        {
          ...order,
          work_turn: summary.turn,
          my_turn: mineTurnFlags(
            { assignedTeamMemberId: order.assigned_team_member_id, summary },
            input.teamMemberId
          ),
        },
      ];
    }
  );

  const buckets = bucketMineTurnOrders(orders, {
    now,
    timeZone: input.timezone,
  });
  const all = buckets.find((bucket) => bucket.id === "all");
  const allOrders = orders.filter(
    (order) => order.my_turn.responsible || order.my_turn.turn
  );

  return operationalJson({
    tenant: input.tenantSlug,
    linked: true,
    team_member: input.teamMember,
    timezone: input.timezone,
    today: getZonedDayBounds(now, input.timezone).date,
    // Todo (default): Soy responsable ∪ Me toca, each order once.
    count: allOrders.length,
    sections: all?.sections ?? [],
    orders: allOrders,
    work_sequence: {
      default_bucket: "all",
      buckets,
    },
  });
}
