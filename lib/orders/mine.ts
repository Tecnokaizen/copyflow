import {
  formatZonedCivilDate,
  getZonedDayBounds,
} from "@/lib/time/zoned-day";

export const MINE_QUEUE_SECTIONS = [
  { id: "urgent", label: "Urgentes" },
  { id: "overdue", label: "Retrasados" },
  { id: "due_today", label: "Entrega hoy" },
  { id: "ready", label: "Listos" },
  { id: "active", label: "Resto activos" },
] as const;

export type MineQueueSectionId = (typeof MINE_QUEUE_SECTIONS)[number]["id"];

export type MineOrder = {
  id: string;
  reference: string;
  title: string;
  priority: string;
  due_at: string | null;
  delivered_at: string | null;
  ready_at: string | null;
  assigned_team_member_id: string | null;
  client_name: string | null;
  service_name: string | null;
  status: {
    name: string;
    code: string | null;
    is_ready: boolean;
    is_closed: boolean;
    is_cancelled: boolean;
  } | null;
};

export type MineQueueSection = {
  id: MineQueueSectionId;
  label: string;
  orders: MineOrder[];
};

export type MineQueryScope = {
  tenantId: string;
  assignedTeamMemberId: string | null;
};

/**
 * Session is the only authority for "my orders".
 * Client-provided tenant or assignee IDs are ignored on purpose.
 */
export function resolveMineQueryScope(input: {
  tenantId: string;
  sessionTeamMemberId: string | null;
  requestedAssigneeId?: string | null;
  requestedTenantId?: string | null;
}): MineQueryScope {
  void input.requestedAssigneeId;
  void input.requestedTenantId;

  return {
    tenantId: input.tenantId,
    assignedTeamMemberId: input.sessionTeamMemberId,
  };
}

export function filterOrdersForMine(
  orders: MineOrder[],
  assignedTeamMemberId: string
) {
  return orders.filter(
    (order) => order.assigned_team_member_id === assignedTeamMemberId
  );
}

function dueCivilDate(dueAt: string | null, timeZone: string): string | null {
  if (!dueAt) {
    return null;
  }

  const due = new Date(dueAt);
  if (Number.isNaN(due.getTime())) {
    return null;
  }

  return formatZonedCivilDate(due, timeZone);
}

function isClosedOrCancelled(order: MineOrder) {
  return (
    order.status?.is_closed === true || order.status?.is_cancelled === true
  );
}

function isReady(order: MineOrder) {
  if (order.delivered_at) {
    return false;
  }

  if (typeof order.status?.is_ready === "boolean") {
    return order.status.is_ready;
  }

  return order.ready_at !== null;
}

export function classifyMineOrder(
  order: MineOrder,
  todayCivil: string,
  timeZone: string
): MineQueueSectionId | null {
  if (isClosedOrCancelled(order)) {
    return null;
  }

  if (order.priority === "urgent") {
    return "urgent";
  }

  const dueCivil = dueCivilDate(order.due_at, timeZone);

  if (dueCivil && dueCivil < todayCivil) {
    return "overdue";
  }

  if (dueCivil && dueCivil === todayCivil) {
    return "due_today";
  }

  if (isReady(order)) {
    return "ready";
  }

  return "active";
}

function compareMineOrders(a: MineOrder, b: MineOrder) {
  if (a.due_at && b.due_at) {
    if (a.due_at !== b.due_at) {
      return a.due_at < b.due_at ? -1 : 1;
    }
  } else if (a.due_at) {
    return -1;
  } else if (b.due_at) {
    return 1;
  }

  return a.reference.localeCompare(b.reference, "es");
}

export function groupMyOrdersQueue(
  orders: MineOrder[],
  options: { now: Date; timeZone: string; assignedTeamMemberId: string }
): MineQueueSection[] {
  const todayCivil = getZonedDayBounds(options.now, options.timeZone).date;
  const mine = filterOrdersForMine(orders, options.assignedTeamMemberId);
  const buckets: Record<MineQueueSectionId, MineOrder[]> = {
    urgent: [],
    overdue: [],
    due_today: [],
    ready: [],
    active: [],
  };

  for (const order of mine) {
    const section = classifyMineOrder(order, todayCivil, options.timeZone);
    if (!section) {
      continue;
    }
    buckets[section].push(order);
  }

  return MINE_QUEUE_SECTIONS.map((section) => ({
    id: section.id,
    label: section.label,
    orders: [...buckets[section.id]].sort(compareMineOrders),
  })).filter((section) => section.orders.length > 0);
}

function asNamed(value: unknown): string | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const name = (value as { name?: unknown }).name;
  return typeof name === "string" && name.trim() ? name : null;
}

function asStatus(value: unknown): MineOrder["status"] {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const name = typeof record.name === "string" ? record.name : null;

  if (!name) {
    return null;
  }

  return {
    name,
    code: typeof record.code === "string" ? record.code : null,
    is_ready: record.is_ready === true,
    is_closed: record.is_closed === true,
    is_cancelled: record.is_cancelled === true,
  };
}

export function mapMineOrderRow(row: unknown): MineOrder | null {
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

  return {
    id,
    reference,
    title,
    priority: typeof record.priority === "string" ? record.priority : "normal",
    due_at: typeof record.due_at === "string" ? record.due_at : null,
    delivered_at:
      typeof record.delivered_at === "string" ? record.delivered_at : null,
    ready_at: typeof record.ready_at === "string" ? record.ready_at : null,
    assigned_team_member_id:
      typeof record.assigned_team_member_id === "string"
        ? record.assigned_team_member_id
        : null,
    client_name: asNamed(record.client),
    service_name: asNamed(record.service),
    status: asStatus(record.status),
  };
}
