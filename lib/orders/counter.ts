import { isUuid } from "@/lib/team/payload";
import { formatZonedCivilDate } from "@/lib/time/zoned-day";

export const COUNTER_BUCKETS = [
  { id: "overdue", label: "Retrasados" },
  { id: "urgent", label: "Urgentes" },
  { id: "ready", label: "Listos para entregar" },
  { id: "notify_pending", label: "Pendientes de avisar" },
  { id: "upcoming", label: "Entregas próximas" },
  { id: "other_active", label: "Otros activos" },
] as const;

export type CounterBucketId = (typeof COUNTER_BUCKETS)[number]["id"];

export const COUNTER_PRIORITIES = ["normal", "high", "urgent"] as const;
export type CounterPriority = (typeof COUNTER_PRIORITIES)[number];
export type CounterViewMode = "list" | "grid";
export const COUNTER_VIEW_STORAGE_KEY = "gestcopy-counter-view";

export type CounterOrder = {
  id: string;
  tenant_id?: string;
  reference: string;
  title: string;
  description?: string | null;
  priority: string;
  due_at: string | null;
  delivered_at: string | null;
  ready_at: string | null;
  customer_notification_status: string | null;
  client_name: string | null;
  service_name: string | null;
  store_name: string | null;
  assignee_name: string | null;
  store_id: string | null;
  assignee_id: string | null;
  service_id: string | null;
  status: {
    name: string;
    is_ready: boolean;
    is_closed: boolean;
    is_cancelled: boolean;
  } | null;
};

export type CounterFilterInput = {
  tenantId: string;
  query: string;
  storeId?: string | null;
  assigneeId?: string | null;
  serviceId?: string | null;
  priority?: string | null;
  mine?: boolean;
  currentTeamMemberId?: string | null;
};

export type CounterFilterParams = {
  query: string;
  storeId: string | null;
  assigneeId: string | null;
  serviceId: string | null;
  priority: CounterPriority | null;
  mine: boolean;
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

export function isOverdueCounterOrder(
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
  return formatZonedCivilDate(due, timeZone) < todayCivil;
}

export function isOtherActiveCounterOrder(
  order: CounterOrder,
  todayCivil: string,
  timeZone: string
) {
  if (!isActive(order)) {
    return false;
  }
  if (isOverdueCounterOrder(order, todayCivil, timeZone)) {
    return false;
  }
  if (isUrgentCounterOrder(order)) {
    return false;
  }
  if (isReadyCounterOrder(order)) {
    return false;
  }
  if (isUpcomingCounterOrder(order, todayCivil, timeZone)) {
    return false;
  }
  return true;
}

export function counterEmptyState(input: {
  filteredCount: number;
  bucketVisibleCount: number;
  filtersActive?: boolean;
}) {
  if (input.filteredCount > 0 || input.bucketVisibleCount > 0) {
    return null;
  }
  return input.filtersActive
    ? "Ningún pedido coincide con los filtros."
    : "No hay pedidos en el mostrador ahora mismo.";
}

export function parseCounterViewMode(
  raw: string | null | undefined
): CounterViewMode {
  return raw === "grid" ? "grid" : "list";
}

export function readStoredCounterView(
  storage: { getItem(key: string): string | null } | null
): CounterViewMode {
  if (!storage) {
    return "list";
  }
  return parseCounterViewMode(storage.getItem(COUNTER_VIEW_STORAGE_KEY));
}

export function hasActiveCounterFilters(filters: {
  storeId?: string | null;
  assigneeId?: string | null;
  serviceId?: string | null;
  priority?: string | null;
  mine?: boolean;
  query?: string | null;
}) {
  void filters.query;
  return Boolean(
    filters.storeId ||
      filters.assigneeId ||
      filters.serviceId ||
      filters.priority ||
      filters.mine
  );
}

function parseUuidParam(raw: string | null) {
  if (!raw || !isUuid(raw)) {
    return null;
  }
  return raw;
}

function parsePriorityParam(raw: string | null): CounterPriority | null {
  if (raw === "normal" || raw === "high" || raw === "urgent") {
    return raw;
  }
  return null;
}

export function parseCounterFilterParams(
  searchParams: URLSearchParams
): CounterFilterParams {
  const mineRaw = searchParams.get("mine");
  return {
    query: normalizeCounterQuery(searchParams.get("q")),
    storeId: parseUuidParam(searchParams.get("store_id")),
    assigneeId: parseUuidParam(searchParams.get("assignee_id")),
    serviceId: parseUuidParam(searchParams.get("service_id")),
    priority: parsePriorityParam(searchParams.get("priority")),
    mine: mineRaw === "1" || mineRaw === "true",
  };
}

export function groupCounterBuckets(
  orders: CounterOrder[],
  input: { todayCivil: string; timeZone: string; previewLimit?: number }
): CounterBucket[] {
  const limit = input.previewLimit ?? PREVIEW_LIMIT;

  const filters: Record<CounterBucketId, (order: CounterOrder) => boolean> = {
    overdue: (order) =>
      isOverdueCounterOrder(order, input.todayCivil, input.timeZone),
    urgent: isUrgentCounterOrder,
    ready: isReadyCounterOrder,
    notify_pending: isNotifyPendingCounterOrder,
    upcoming: (order) =>
      isUpcomingCounterOrder(order, input.todayCivil, input.timeZone),
    other_active: (order) =>
      isOtherActiveCounterOrder(order, input.todayCivil, input.timeZone),
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
    description:
      typeof record.description === "string" ? record.description : null,
    client_name: typeof client?.name === "string" ? client.name : null,
    service_name: typeof service?.name === "string" ? service.name : null,
    store_name: typeof store?.name === "string" ? store.name : null,
    assignee_name: typeof assignee?.name === "string" ? assignee.name : null,
    store_id: typeof record.store_id === "string" ? record.store_id : null,
    assignee_id:
      typeof record.assigned_team_member_id === "string"
        ? record.assigned_team_member_id
        : null,
    service_id:
      typeof record.service_id === "string" ? record.service_id : null,
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
  input: CounterFilterInput
) {
  if (input.mine && !input.currentTeamMemberId) {
    return [];
  }

  return orders.filter((order) => {
    if (!belongsToCounterTenant(order, input.tenantId)) {
      return false;
    }
    if (!matchesCounterSearch(order, input.query)) {
      return false;
    }
    if (input.storeId && order.store_id !== input.storeId) {
      return false;
    }
    if (input.assigneeId && order.assignee_id !== input.assigneeId) {
      return false;
    }
    if (input.serviceId && order.service_id !== input.serviceId) {
      return false;
    }
    if (input.priority && order.priority !== input.priority) {
      return false;
    }
    if (input.mine && order.assignee_id !== input.currentTeamMemberId) {
      return false;
    }
    return true;
  });
}

export function normalizeCounterQuery(raw: string | null | undefined) {
  return (raw ?? "").trim().slice(0, 80);
}
