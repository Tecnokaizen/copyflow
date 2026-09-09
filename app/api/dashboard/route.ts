import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentContext } from "@/lib/tenant/current-context";
import { mapTeamMember, unwrapRpcPayload } from "@/lib/team/types";
import { statusForTeamRpcError } from "@/lib/team/rpc-error";
import { getZonedDayBounds, resolveTimeZone } from "@/lib/time/zoned-day";
import type {
  DashboardAttentionOrder,
  DashboardUpcomingOrder,
} from "@/lib/dashboard/types";

const UPCOMING_LIMIT = 8;
const ATTENTION_LIMIT = 8;

const ACTIVE_COUNT_SELECT =
  "id, status:order_statuses!inner(is_closed,is_cancelled,is_ready)";

const ORDER_PREVIEW_SELECT = `
  id,
  reference,
  title,
  priority,
  due_at,
  assigned_team_member:team_members(name),
  status:order_statuses!inner(name, is_ready, is_closed, is_cancelled)
`;

function activeOrdersQuery(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tenantId: string,
  options?: { head?: boolean; select?: string }
) {
  return supabase
    .from("orders")
    .select(options?.select ?? ACTIVE_COUNT_SELECT, {
      count: "exact",
      head: options?.head ?? true,
    })
    .eq("tenant_id", tenantId)
    .is("archived_at", null)
    .eq("status.is_closed", false)
    .eq("status.is_cancelled", false);
}

function asPreviewOrder(row: unknown): DashboardUpcomingOrder | null {
  if (!row || typeof row !== "object") {
    return null;
  }

  const record = row as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id : null;
  const reference = typeof record.reference === "string" ? record.reference : null;
  const title = typeof record.title === "string" ? record.title : null;

  if (!id || !reference || !title) {
    return null;
  }

  const assignee =
    record.assigned_team_member &&
    typeof record.assigned_team_member === "object"
      ? (record.assigned_team_member as { name?: unknown })
      : null;

  const status =
    record.status && typeof record.status === "object"
      ? (record.status as { name?: unknown; is_ready?: unknown })
      : null;

  return {
    id,
    reference,
    title,
    priority: typeof record.priority === "string" ? record.priority : "normal",
    due_at: typeof record.due_at === "string" ? record.due_at : null,
    assigned_team_member:
      typeof assignee?.name === "string" ? { name: assignee.name } : null,
    status:
      typeof status?.name === "string"
        ? { name: status.name, is_ready: status.is_ready === true }
        : null,
  };
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
  const tenantId = context.tenant.id;
  const now = new Date();

  const { data: settings } = await supabase
    .from("tenant_settings")
    .select("timezone")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  const timezone = resolveTimeZone(
    typeof settings?.timezone === "string" ? settings.timezone : null
  );
  const day = getZonedDayBounds(now, timezone);
  const nowIso = now.toISOString();
  const dayStartIso = day.start.toISOString();
  const dayEndIso = day.end.toISOString();

  const [
    activeResult,
    urgentResult,
    overdueResult,
    dueTodayResult,
    upcomingCountResult,
    needsAttentionResult,
    upcomingListResult,
    attentionListResult,
    teamResult,
  ] = await Promise.all([
    activeOrdersQuery(supabase, tenantId),
    activeOrdersQuery(supabase, tenantId).eq("priority", "urgent"),
    activeOrdersQuery(supabase, tenantId)
      .not("due_at", "is", null)
      .lt("due_at", nowIso),
    activeOrdersQuery(supabase, tenantId)
      .gte("due_at", dayStartIso)
      .lt("due_at", dayEndIso),
    activeOrdersQuery(supabase, tenantId).gte("due_at", dayEndIso),
    activeOrdersQuery(supabase, tenantId).eq("status.is_ready", true),
    activeOrdersQuery(supabase, tenantId, {
      head: false,
      select: ORDER_PREVIEW_SELECT,
    })
      .gte("due_at", dayEndIso)
      .order("due_at", { ascending: true })
      .order("id", { ascending: true })
      .range(0, UPCOMING_LIMIT - 1),
    activeOrdersQuery(supabase, tenantId, {
      head: false,
      select: ORDER_PREVIEW_SELECT,
    })
      .eq("status.is_ready", true)
      .order("due_at", { ascending: true, nullsFirst: false })
      .order("id", { ascending: true })
      .range(0, ATTENTION_LIMIT - 1),
    supabase.rpc("list_team_members", {
      p_tenant_id: tenantId,
      p_query: null,
      p_active: true,
    }),
  ]);

  const countResults = [
    activeResult,
    urgentResult,
    overdueResult,
    dueTodayResult,
    upcomingCountResult,
    needsAttentionResult,
  ];

  const failedCount = countResults.find((result) => result.error);

  if (failedCount?.error) {
    console.error("[GET /api/dashboard] Could not load dashboard counts", {
      tenantId,
      error: failedCount.error,
    });

    return NextResponse.json(
      { error: "Could not load dashboard" },
      { status: 500 }
    );
  }

  if (upcomingListResult.error) {
    console.error("[GET /api/dashboard] Could not load upcoming orders", {
      tenantId,
      error: upcomingListResult.error,
    });

    return NextResponse.json(
      { error: "Could not load dashboard" },
      { status: 500 }
    );
  }

  if (attentionListResult.error) {
    console.error("[GET /api/dashboard] Could not load attention orders", {
      tenantId,
      error: attentionListResult.error,
    });

    return NextResponse.json(
      { error: "Could not load dashboard" },
      { status: 500 }
    );
  }

  if (teamResult.error || !teamResult.data) {
    console.error(
      "[GET /api/dashboard] list_team_members",
      teamResult.error?.message ?? "unknown error"
    );

    return NextResponse.json(
      { error: "Could not load dashboard" },
      { status: statusForTeamRpcError(teamResult.error?.code) }
    );
  }

  const teamRecord = unwrapRpcPayload(teamResult.data);
  const rawMembers = Array.isArray(teamRecord.members) ? teamRecord.members : [];
  const members = rawMembers
    .map((row) => mapTeamMember(row))
    .filter((row): row is NonNullable<typeof row> => row !== null)
    .map((member) => ({
      id: member.id,
      name: member.name,
      job_title: member.job_title,
      active: member.active,
      can_receive_orders: member.can_receive_orders,
      active_orders_count: member.active_orders_count,
    }))
    .sort((a, b) => {
      if (b.active_orders_count !== a.active_orders_count) {
        return b.active_orders_count - a.active_orders_count;
      }

      return a.name.localeCompare(b.name, "es");
    });

  const upcomingOrders = (upcomingListResult.data ?? [])
    .map((row) => asPreviewOrder(row))
    .filter((row): row is DashboardUpcomingOrder => row !== null);

  const attentionOrders = (attentionListResult.data ?? [])
    .map((row) => asPreviewOrder(row))
    .filter((row): row is DashboardAttentionOrder => row !== null);

  return NextResponse.json({
    tenant: context.tenant.slug,
    timezone,
    local_date: day.date,
    counts: {
      active: activeResult.count ?? 0,
      urgent: urgentResult.count ?? 0,
      overdue: overdueResult.count ?? 0,
      due_today: dueTodayResult.count ?? 0,
      upcoming: upcomingCountResult.count ?? 0,
      needs_attention: needsAttentionResult.count ?? 0,
    },
    needs_attention_includes: {
      ready: true,
      incomplete_files: false,
      pending_quote: false,
      blocked: false,
    },
    upcoming_orders: upcomingOrders,
    attention_orders: attentionOrders,
    workload: {
      active_orders_count: Number(teamRecord.active_orders_count ?? 0) || 0,
      members,
    },
  });
}
