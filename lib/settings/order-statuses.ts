export const ORDER_STATUS_KINDS = [
  "initial",
  "in_progress",
  "ready",
  "closed",
  "cancelled",
] as const;

export type OrderStatusKind = (typeof ORDER_STATUS_KINDS)[number];

export const ORDER_STATUS_KIND_LABELS: Record<OrderStatusKind, string> = {
  initial: "Inicial",
  in_progress: "En proceso",
  ready: "Listo",
  closed: "Entregado",
  cancelled: "Cancelado",
};

export type OrderStatusItem = {
  id: string;
  code: string;
  name: string;
  active: boolean;
  is_initial: boolean;
  is_ready: boolean;
  is_closed: boolean;
  is_cancelled: boolean;
  sort_order: number;
};

export type OrderStatusPayload = {
  name: string;
  kind: OrderStatusKind;
  active: boolean;
  sort_order: number;
};

function asBoolean(value: unknown, fallback = false) {
  if (value === undefined || value === null) {
    return fallback;
  }
  return value === true || value === "true" || value === 1;
}

function asNumber(value: unknown, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

export function isOrderStatusKind(value: unknown): value is OrderStatusKind {
  return (
    typeof value === "string" &&
    ORDER_STATUS_KINDS.includes(value as OrderStatusKind)
  );
}

export function orderStatusKindFromFlags(input: {
  is_initial?: boolean | null;
  is_ready?: boolean | null;
  is_closed?: boolean | null;
  is_cancelled?: boolean | null;
}): OrderStatusKind {
  if (input.is_initial) return "initial";
  if (input.is_cancelled) return "cancelled";
  if (input.is_closed) return "closed";
  if (input.is_ready) return "ready";
  return "in_progress";
}

export function statusCodeBaseFromName(name: string) {
  const normalized = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48)
    .replace(/_+$/g, "");

  return normalized || "status";
}

export function nextAvailableStatusCode(
  name: string,
  existingCodes: Iterable<string>
) {
  const used = new Set(
    Array.from(existingCodes, (value) => value.trim().toLowerCase())
  );
  const base = statusCodeBaseFromName(name);

  if (!used.has(base)) {
    return base;
  }

  for (let suffix = 2; suffix <= 9999; suffix += 1) {
    const suffixText = `_${suffix}`;
    const candidate = `${base.slice(0, 64 - suffixText.length)}${suffixText}`;
    if (!used.has(candidate)) {
      return candidate;
    }
  }

  return null;
}

export function parseOrderStatusPayload(
  payload: Record<string, unknown>
): { ok: true; data: OrderStatusPayload } | { ok: false } {
  const allowed = new Set(["name", "kind", "active", "sort_order"]);
  if (Object.keys(payload).some((key) => !allowed.has(key))) {
    return { ok: false };
  }

  if (typeof payload.name !== "string" || !isOrderStatusKind(payload.kind)) {
    return { ok: false };
  }

  const name = payload.name.trim();
  if (!name || name.length > 100) {
    return { ok: false };
  }

  if (typeof payload.active !== "boolean") {
    return { ok: false };
  }

  const rawSort = payload.sort_order;
  const sortOrder =
    typeof rawSort === "number"
      ? rawSort
      : typeof rawSort === "string" && rawSort.trim()
        ? Number(rawSort)
        : Number.NaN;

  if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 100000) {
    return { ok: false };
  }

  return {
    ok: true,
    data: {
      name,
      kind: payload.kind,
      active: payload.kind === "initial" ? true : payload.active,
      sort_order: sortOrder,
    },
  };
}

export function mapOrderStatus(row: unknown): OrderStatusItem | null {
  if (!row || typeof row !== "object") {
    return null;
  }

  const record = row as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id : null;
  const code = typeof record.code === "string" ? record.code : null;
  const name = typeof record.name === "string" ? record.name.trim() : "";

  if (!id || !code || !name) {
    return null;
  }

  return {
    id,
    code,
    name,
    active: record.active === undefined ? true : asBoolean(record.active, true),
    is_initial: asBoolean(record.is_initial),
    is_ready: asBoolean(record.is_ready),
    is_closed: asBoolean(record.is_closed),
    is_cancelled: asBoolean(record.is_cancelled),
    sort_order: Math.max(0, Math.round(asNumber(record.sort_order, 0))),
  };
}

export function unwrapOrderStatusRpc(data: unknown): OrderStatusItem | null {
  const payload = Array.isArray(data) ? data[0] : data;
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const record = payload as Record<string, unknown>;
  return mapOrderStatus(record.status ?? record);
}

export function orderStatusWriteHttpStatus(code: string | undefined) {
  switch (code) {
    case "28000":
    case "42501":
      return 403;
    case "P0002":
      return 404;
    case "23505":
    case "23514":
      return 409;
    case "22023":
      return 400;
    default:
      return 500;
  }
}
