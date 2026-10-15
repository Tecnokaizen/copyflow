import { applyOperationalOrdersFilter } from "@/lib/orders/operational";
import {
  classifyOrderReview,
  REVIEW_REASON_ORDER,
  type ReviewContext,
  type ReviewOrderInput,
  type ReviewReason,
} from "@/lib/orders/review";
import { getZonedDayBounds, resolveTimeZone } from "@/lib/time/zoned-day";

const REVIEW_PAGE = 1000;
export const REVIEW_ID_CHUNK = 80;

const REVIEW_SELECT = `
  id,
  due_at,
  assigned_team_member_id,
  customer_notification_status,
  archived_at,
  status:order_statuses!inner(is_ready, is_closed, is_cancelled)
`;

type LoadError = { message?: string } | null;

export type TenantZonedDay = {
  timezone: string;
  localDate: string;
  dayStart: Date;
  dayEnd: Date;
};

export type LoadedReviewOrder = ReviewOrderInput & {
  id: string;
  reasons: ReviewReason[];
};

function asReviewInput(row: unknown): (ReviewOrderInput & { id: string }) | null {
  if (!row || typeof row !== "object") {
    return null;
  }

  const record = row as Record<string, unknown>;
  if (typeof record.id !== "string") {
    return null;
  }

  const status =
    record.status && typeof record.status === "object"
      ? (record.status as {
          is_ready?: unknown;
          is_closed?: unknown;
          is_cancelled?: unknown;
        })
      : null;

  return {
    id: record.id,
    due_at: typeof record.due_at === "string" ? record.due_at : null,
    assigned_team_member_id:
      typeof record.assigned_team_member_id === "string"
        ? record.assigned_team_member_id
        : null,
    customer_notification_status:
      typeof record.customer_notification_status === "string"
        ? record.customer_notification_status
        : null,
    archived_at: typeof record.archived_at === "string" ? record.archived_at : null,
    status: status
      ? {
          is_ready: status.is_ready === true,
          is_closed: status.is_closed === true,
          is_cancelled: status.is_cancelled === true,
        }
      : null,
  };
}

async function pageRule(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- supabase builder, same as operational.ts
  supabase: any,
  tenantId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  refine: (query: any) => any
): Promise<{ error: LoadError; rows: Array<ReviewOrderInput & { id: string }> }> {
  const rows: Array<ReviewOrderInput & { id: string }> = [];
  let offset = 0;

  while (true) {
    let query = applyOperationalOrdersFilter(
      supabase.from("orders").select(REVIEW_SELECT).eq("tenant_id", tenantId)
    );
    query = refine(query);
    const { data, error } = await query
      .order("id", { ascending: true })
      .range(offset, offset + REVIEW_PAGE - 1);

    if (error) {
      return { error, rows: [] };
    }

    const batch = (data ?? []) as unknown[];
    for (const row of batch) {
      const parsed = asReviewInput(row);
      if (parsed) {
        rows.push(parsed);
      }
    }

    if (batch.length < REVIEW_PAGE) {
      break;
    }

    offset += REVIEW_PAGE;
  }

  return { error: null, rows };
}

export async function loadTenantZonedDay(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- supabase builder
  supabase: any,
  tenantId: string,
  now = new Date()
): Promise<{ error: LoadError; day: TenantZonedDay | null }> {
  const { data, error } = await supabase
    .from("tenant_settings")
    .select("timezone")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (error) {
    return { error, day: null };
  }

  const timezone = resolveTimeZone(
    typeof data?.timezone === "string" ? data.timezone : null
  );
  const bounds = getZonedDayBounds(now, timezone);

  return {
    error: null,
    day: {
      timezone,
      localDate: bounds.date,
      dayStart: bounds.start,
      dayEnd: bounds.end,
    },
  };
}

/**
 * Unique operational orders that require review.
 * Four tenant-scoped reads are unioned and reclassified so one order
 * with several reasons is returned once. No new SQL, RPC, or service role.
 */
export async function loadOperationalReviewOrders(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- supabase builder
  supabase: any,
  tenantId: string,
  day: TenantZonedDay,
  now = new Date()
): Promise<{ error: LoadError; orders: LoadedReviewOrder[] }> {
  const dayStartIso = day.dayStart.toISOString();
  const dayEndIso = day.dayEnd.toISOString();
  const context: ReviewContext = { timeZone: day.timezone, now };

  const [overdue, dueToday, notify, unassigned] = await Promise.all([
    pageRule(supabase, tenantId, (query) =>
      query.not("due_at", "is", null).lt("due_at", dayStartIso)
    ),
    pageRule(supabase, tenantId, (query) =>
      query.gte("due_at", dayStartIso).lt("due_at", dayEndIso)
    ),
    pageRule(supabase, tenantId, (query) =>
      query
        .eq("status.is_ready", true)
        .eq("customer_notification_status", "not_notified")
    ),
    pageRule(supabase, tenantId, (query) =>
      query.is("assigned_team_member_id", null)
    ),
  ]);

  const failed = [overdue, dueToday, notify, unassigned].find(
    (result) => result.error
  );
  if (failed?.error) {
    return { error: failed.error, orders: [] };
  }

  const merged = new Map<string, ReviewOrderInput & { id: string }>();
  for (const result of [overdue, dueToday, notify, unassigned]) {
    for (const row of result.rows) {
      if (!merged.has(row.id)) {
        merged.set(row.id, row);
      }
    }
  }

  const orders: LoadedReviewOrder[] = [];
  for (const row of merged.values()) {
    const reasons = classifyOrderReview(row, context);
    if (reasons.length === 0) {
      continue;
    }

    orders.push({ ...row, reasons });
  }

  orders.sort((left, right) => {
    const rank =
      REVIEW_REASON_ORDER.indexOf(left.reasons[0].code) -
      REVIEW_REASON_ORDER.indexOf(right.reasons[0].code);
    if (rank !== 0) {
      return rank;
    }

    const leftDue = left.due_at ? Date.parse(left.due_at) : Number.POSITIVE_INFINITY;
    const rightDue = right.due_at
      ? Date.parse(right.due_at)
      : Number.POSITIVE_INFINITY;
    if (leftDue !== rightDue) {
      return leftDue - rightDue;
    }

    return left.id.localeCompare(right.id);
  });

  return { error: null, orders };
}
