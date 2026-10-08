import { isOrderOperational } from "@/lib/orders/operational";
import {
  formatZonedCivilDate,
  formatZonedTime,
  getZonedDayBounds,
} from "@/lib/time/zoned-day";

/**
 * Canonical "requiere revisión" semantics for the dashboard and
 * `/orders?filter=attention`.
 *
 * Ready means the current status flag `status.is_ready === true`.
 * `ready_at` is sticky and must not be read here.
 *
 * "Retrasado" is the tenant civil day before today, so it cannot overlap
 * "entrega hoy". The existing overdue list filter stays `due_at < now`.
 */

export const REVIEW_REASON_ORDER = [
  "overdue",
  "due_today_pending",
  "customer_not_notified",
  "unassigned",
] as const;

export type ReviewReasonCode = (typeof REVIEW_REASON_ORDER)[number];

export type ReviewReasonTone = "danger" | "warning" | "brand" | "neutral";

export type ReviewReason = {
  code: ReviewReasonCode;
  label: string;
  tone: ReviewReasonTone;
};

export const REVIEW_REASONS: Record<ReviewReasonCode, ReviewReason> = {
  overdue: { code: "overdue", label: "Retrasado", tone: "danger" },
  due_today_pending: {
    code: "due_today_pending",
    label: "Entrega hoy pendiente",
    tone: "warning",
  },
  customer_not_notified: {
    code: "customer_not_notified",
    label: "Avisar al cliente",
    tone: "brand",
  },
  unassigned: {
    code: "unassigned",
    label: "Sin responsable",
    tone: "warning",
  },
};

export const NEEDS_ATTENTION_INCLUDES = {
  overdue: true,
  due_today_pending: true,
  customer_not_notified: true,
  unassigned: true,
  ready: false,
  incomplete_files: false,
  pending_quote: false,
  blocked: false,
} as const;

export type ReviewOrderInput = {
  id?: string;
  archived_at?: string | null;
  due_at?: string | null;
  assigned_team_member_id?: string | null;
  customer_notification_status?: string | null;
  ready_at?: string | null;
  status_id?: string | null;
  store_id?: string | null;
  status?: {
    is_closed?: boolean | null;
    is_cancelled?: boolean | null;
    is_ready?: boolean | null;
  } | null;
};

export type ReviewContext = {
  timeZone: string;
  now: Date;
};

export type ReviewListFilters = {
  storeId?: string | null;
  assignedTeamMemberId?: string | null;
  statusId?: string | null;
};

function validDue(dueAt: string | null | undefined): Date | null {
  if (!dueAt) {
    return null;
  }

  const due = new Date(dueAt);
  return Number.isNaN(due.getTime()) ? null : due;
}

function hasAssignee(order: ReviewOrderInput): boolean {
  return (
    typeof order.assigned_team_member_id === "string" &&
    order.assigned_team_member_id.trim().length > 0
  );
}

function isCurrentReady(order: ReviewOrderInput): boolean {
  return order.status?.is_ready === true;
}

/**
 * Superset fetched by the tenant-scoped candidate queries.
 * Classification drops rows that do not actually require review
 * (for example a ready order due today that is already notified and assigned).
 */
export function matchesReviewCandidateQuery(
  order: ReviewOrderInput,
  context: ReviewContext
): boolean {
  if (!isOrderOperational(order)) {
    return false;
  }

  const day = getZonedDayBounds(context.now, context.timeZone);
  const due = validDue(order.due_at);

  if (due && due < day.start) {
    return true;
  }

  if (due && due >= day.start && due < day.end) {
    return true;
  }

  if (
    isCurrentReady(order) &&
    order.customer_notification_status === "not_notified"
  ) {
    return true;
  }

  return !hasAssignee(order);
}

export function classifyOrderReview(
  order: ReviewOrderInput,
  context: ReviewContext
): ReviewReason[] {
  if (!isOrderOperational(order)) {
    return [];
  }

  const present = new Set<ReviewReasonCode>();
  const day = getZonedDayBounds(context.now, context.timeZone);
  const due = validDue(order.due_at);

  if (due) {
    const civil = formatZonedCivilDate(due, context.timeZone);
    if (civil < day.date) {
      present.add("overdue");
    } else if (civil === day.date && !isCurrentReady(order)) {
      present.add("due_today_pending");
    }
  }

  if (
    isCurrentReady(order) &&
    order.customer_notification_status === "not_notified"
  ) {
    present.add("customer_not_notified");
  }

  if (!hasAssignee(order)) {
    present.add("unassigned");
  }

  return REVIEW_REASON_ORDER.filter((code) => present.has(code)).map(
    (code) => REVIEW_REASONS[code]
  );
}

export function orderRequiresReview(
  order: ReviewOrderInput,
  context: ReviewContext
): boolean {
  return classifyOrderReview(order, context).length > 0;
}

export function isOperationalDueToday(
  order: ReviewOrderInput,
  context: ReviewContext
): boolean {
  if (!isOrderOperational(order)) {
    return false;
  }

  const due = validDue(order.due_at);
  if (!due) {
    return false;
  }

  const day = getZonedDayBounds(context.now, context.timeZone);
  return formatZonedCivilDate(due, context.timeZone) === day.date;
}

export function formatReviewDueLine(
  dueAt: string | null | undefined,
  timeZone: string,
  localDate: string
): string | null {
  const due = validDue(dueAt);
  if (!due) {
    return null;
  }

  const time = formatZonedTime(due, timeZone);
  const civil = formatZonedCivilDate(due, timeZone);
  if (civil === localDate) {
    return `Hoy ${time}`;
  }

  const date = new Intl.DateTimeFormat("es-ES", {
    timeZone,
    day: "2-digit",
    month: "short",
  })
    .format(due)
    .replace(/\.$/, "");

  return `${date} ${time}`;
}

export function formatTenantDueLabel(
  dueAt: string | null | undefined,
  timeZone: string,
  localDate: string,
  operational: boolean
): {
  dueToday: boolean;
  overdue: boolean;
  label: string;
  indicator: "Entrega hoy" | null;
} {
  const due = validDue(dueAt);
  if (!due) {
    return {
      dueToday: false,
      overdue: false,
      label: "Sin fecha",
      indicator: null,
    };
  }

  const civil = formatZonedCivilDate(due, timeZone);
  const dueToday = operational && civil === localDate;
  const overdue = operational && civil < localDate;

  if (dueToday) {
    return {
      dueToday: true,
      overdue: false,
      label: `HOY · ${formatZonedTime(due, timeZone)}`,
      indicator: "Entrega hoy",
    };
  }

  return {
    dueToday: false,
    overdue,
    label: new Intl.DateTimeFormat("es-ES", {
      timeZone,
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(due),
    indicator: null,
  };
}

export type ClassifiedReviewOrder<T extends ReviewOrderInput> = T & {
  reasons: ReviewReason[];
};

function reviewSortRank(reasons: ReviewReason[]): number {
  if (reasons.length === 0) {
    return REVIEW_REASON_ORDER.length;
  }

  return REVIEW_REASON_ORDER.indexOf(reasons[0].code);
}

export function collectReviewOrders<T extends ReviewOrderInput>(
  orders: T[],
  context: ReviewContext
): Array<ClassifiedReviewOrder<T>> {
  const seen = new Set<string>();
  const collected: Array<ClassifiedReviewOrder<T>> = [];

  for (const order of orders) {
    if (!order.id || seen.has(order.id)) {
      continue;
    }

    if (!matchesReviewCandidateQuery(order, context)) {
      continue;
    }

    const reasons = classifyOrderReview(order, context);
    if (reasons.length === 0) {
      continue;
    }

    seen.add(order.id);
    collected.push({ ...order, reasons });
  }

  collected.sort((left, right) => {
    const rank = reviewSortRank(left.reasons) - reviewSortRank(right.reasons);
    if (rank !== 0) {
      return rank;
    }

    const leftDue = validDue(left.due_at)?.getTime() ?? Number.POSITIVE_INFINITY;
    const rightDue = validDue(right.due_at)?.getTime() ?? Number.POSITIVE_INFINITY;
    if (leftDue !== rightDue) {
      return leftDue - rightDue;
    }

    return (left.id ?? "").localeCompare(right.id ?? "");
  });

  return collected;
}

export function filterReviewOrders<T extends ReviewOrderInput>(
  orders: T[],
  context: ReviewContext,
  filters: ReviewListFilters = {}
): Array<ClassifiedReviewOrder<T>> {
  return collectReviewOrders(orders, context).filter((order) => {
    if (filters.storeId && order.store_id !== filters.storeId) {
      return false;
    }

    if (
      filters.assignedTeamMemberId &&
      order.assigned_team_member_id !== filters.assignedTeamMemberId
    ) {
      return false;
    }

    if (filters.statusId && order.status_id !== filters.statusId) {
      return false;
    }

    return true;
  });
}
