import { formatZonedCivilDate } from "@/lib/time/zoned-day";

export const COUNTER_BUCKETS = [
  { id: "urgent", label: "Urgentes" },
  { id: "ready", label: "Listos para entregar" },
  { id: "notify_pending", label: "Pendientes de avisar" },
  { id: "upcoming", label: "Entregas próximas" },
] as const;

export type CounterBucketId = (typeof COUNTER_BUCKETS)[number]["id"];

export type CounterOrder = {
  id: string;
  tenant_id?: string;
  reference: string;
  title: string;
  priority: string;
  due_at: string | null;
  delivered_at: string | null;
  ready_at: string | null;
  customer_notification_status: string | null;
  client_name: string | null;
  service_name: string | null;
  store_name: string | null;
  assignee_name: string | null;
  status: {
    name: string;
    is_ready: boolean;
    is_closed: boolean;
    is_cancelled: boolean;
  } | null;
};

export type CounterBucket = {
  id: CounterBucketId;
  label: string;
  count: number;
  orders: CounterOrder[];
};

const PREVIEW_LIMIT = 8;

function isClosed(order: CounterOrder) {
  return (
    order.status?.is_closed === true || order.status?.is_cancelled === true
  );
}

function isActive(order: CounterOrder) {
  return !isClosed(order) && order.delivered_at === null;
}

function isReady(order: CounterOrder) {
  if (!isActive(order)) {
    return false;
  }
  if (typeof order.status?.is_ready === "boolean") {
    return order.status.is_ready;
  }
  return order.ready_at !== null;
}

export function matchesCounterSearch(order: CounterOrder, query: string) {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return true;
  }

  const haystack = [
    order.reference,
    order.title,
    order.client_name ?? "",
  ]
    .join(" ")
    .toLowerCase();

  return haystack.includes(needle);
}

export function belongsToCounterTenant(
  order: { tenant_id?: string },
  tenantId: string
) {
  if (!order.tenant_id) {
    return true;
  }
  return order.tenant_id === tenantId;
}

export function isUrgentCounterOrder(order: CounterOrder) {
  return isActive(order) && order.priority === "urgent";
}

export function isReadyCounterOrder(order: CounterOrder) {
  return isReady(order);
}

export function isNotifyPendingCounterOrder(order: CounterOrder) {
  return (
    isReady(order) &&
    (order.customer_notification_status === "not_notified" ||
      order.customer_notification_status === null ||
      order.customer_notification_status === "")
  );
}

export function isUpcomingCounterOrder(
  order: CounterOrder,
  todayCivil: string,
  timeZone: string
) {
  if (!isActive(order) || !order.due_at) {
    return false;
  }
  const due = new Date(order.due_at);
  if (Number.isNaN(due.getTime())) {
    return false;
  }
  return formatZonedCivilDate(due, timeZone) >= todayCivil;
}

export function groupCounterBuckets(
  orders: CounterOrder[],
  input: { todayCivil: string; timeZone: string; previewLimit?: number }
): CounterBucket[] {
  const limit = input.previewLimit ?? PREVIEW_LIMIT;

  const filters: Record<CounterBucketId, (order: CounterOrder) => boolean> = {
    urgent: isUrgentCounterOrder,
    ready: isReadyCounterOrder,
    notify_pending: isNotifyPendingCounterOrder,
    upcoming: (order) =>
      isUpcomingCounterOrder(order, input.todayCivil, input.timeZone),
  };

  return COUNTER_BUCKETS.map((bucket) => {
    const matched = orders.filter(filters[bucket.id]);
    return {
      id: bucket.id,
      label: bucket.label,
      count: matched.length,
      orders: matched.slice(0, limit),
    };
  });
}

export function mapCounterOrderRow(row: unknown): CounterOrder | null {
  if (!row || typeof row !== "object") {
    return null;
  }
  const record = row as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id : null;
  const reference =
    typeof record.reference === "string" ? record.reference : null;
  const title = typeof record.title === "string" ? record.title : null;
  if (!id || !reference || !title) {
    return null;
  }

  const client =
    record.client && typeof record.client === "object"
      ? (record.client as { name?: unknown })
      : null;
  const service =
    record.service && typeof record.service === "object"
      ? (record.service as { name?: unknown })
      : null;
  const store =
    record.store && typeof record.store === "object"
      ? (record.store as { name?: unknown })
      : null;
  const assignee =
    record.assigned_team_member &&
    typeof record.assigned_team_member === "object"
      ? (record.assigned_team_member as { name?: unknown })
      : null;
  const status =
    record.status && typeof record.status === "object"
      ? (record.status as Record<string, unknown>)
      : null;

  return {
    id,
    tenant_id: typeof record.tenant_id === "string" ? record.tenant_id : undefined,
    reference,
    title,
    priority: typeof record.priority === "string" ? record.priority : "normal",
    due_at: typeof record.due_at === "string" ? record.due_at : null,
    delivered_at:
      typeof record.delivered_at === "string" ? record.delivered_at : null,
    ready_at: typeof record.ready_at === "string" ? record.ready_at : null,
    customer_notification_status:
      typeof record.customer_notification_status === "string"
        ? record.customer_notification_status
        : null,
    client_name: typeof client?.name === "string" ? client.name : null,
    service_name: typeof service?.name === "string" ? service.name : null,
    store_name: typeof store?.name === "string" ? store.name : null,
    assignee_name: typeof assignee?.name === "string" ? assignee.name : null,
    status:
      typeof status?.name === "string"
        ? {
            name: status.name,
            is_ready: status.is_ready === true,
            is_closed: status.is_closed === true,
            is_cancelled: status.is_cancelled === true,
          }
        : null,
  };
}

export function filterOrdersForCounter(
  orders: CounterOrder[],
  input: { tenantId: string; query: string }
) {
  return orders.filter(
    (order) =>
      belongsToCounterTenant(order, input.tenantId) &&
      matchesCounterSearch(order, input.query)
  );
}

export function normalizeCounterQuery(raw: string | null | undefined) {
  return (raw ?? "").trim().slice(0, 80);
}
