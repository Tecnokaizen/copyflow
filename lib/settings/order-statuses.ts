export const ORDER_STATUS_KINDS = [
  "initial",
  "in_progress",
  "ready",
  "closed",
  "cancelled",
] as const;

/** Kinds allowed when creating or editing a non-initial status. */
export const ORDER_STATUS_EDITABLE_KINDS = [
  "in_progress",
  "ready",
  "closed",
  "cancelled",
] as const;

export type OrderStatusKind = (typeof ORDER_STATUS_KINDS)[number];
export type OrderStatusEditableKind =
  (typeof ORDER_STATUS_EDITABLE_KINDS)[number];

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
  kind: OrderStatusEditableKind;
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

export function isOrderStatusEditableKind(
  value: unknown
): value is OrderStatusEditableKind {
  return (
    typeof value === "string" &&
    ORDER_STATUS_EDITABLE_KINDS.includes(value as OrderStatusEditableKind)
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

  // Clients must not invent is_initial; use set-initial instead.
  if ("is_initial" in payload) {
    return { ok: false };
  }

  if (
    typeof payload.name !== "string" ||
    !isOrderStatusEditableKind(payload.kind)
  ) {
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
      active: payload.active,
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

export type OrderStatusDomainError =
  | "initial_status_cannot_be_deactivated"
  | "inactive_status_cannot_be_initial"
  | "initial_status_must_use_set_initial"
  | "tenant_must_keep_one_active_initial"
  | "duplicate_status"
  | "not_found"
  | "forbidden"
  | "invalid_value";

export function orderStatusDomainError(
  code: string | undefined,
  message: string | undefined
): OrderStatusDomainError | null {
  const text = (message ?? "").toLowerCase();

  if (text.includes("initial_status_cannot_be_deactivated")) {
    return "initial_status_cannot_be_deactivated";
  }
  if (text.includes("inactive_status_cannot_be_initial")) {
    return "inactive_status_cannot_be_initial";
  }
  if (text.includes("initial_status_must_use_set_initial")) {
    return "initial_status_must_use_set_initial";
  }
  if (text.includes("tenant must keep one active initial")) {
    return "tenant_must_keep_one_active_initial";
  }

  switch (code) {
    case "28000":
    case "42501":
      return "forbidden";
    case "P0002":
      return "not_found";
    case "23505":
      return "duplicate_status";
    case "23514":
      return "tenant_must_keep_one_active_initial";
    case "22023":
      return "invalid_value";
    default:
      return null;
  }
}

export function orderStatusWriteHttpStatus(
  domain: OrderStatusDomainError | null,
  code?: string
) {
  switch (domain) {
    case "forbidden":
      return 403;
    case "not_found":
      return 404;
    case "initial_status_cannot_be_deactivated":
    case "inactive_status_cannot_be_initial":
    case "tenant_must_keep_one_active_initial":
    case "duplicate_status":
      return 409;
    case "initial_status_must_use_set_initial":
    case "invalid_value":
      return 400;
    default:
      return orderStatusWriteHttpStatusFallback(code);
  }
}

function orderStatusWriteHttpStatusFallback(code: string | undefined) {
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

export function orderStatusDomainErrorMessage(
  domain: OrderStatusDomainError | null,
  fallback = "Could not update order status"
) {
  switch (domain) {
    case "initial_status_cannot_be_deactivated":
      return "initial_status_cannot_be_deactivated";
    case "inactive_status_cannot_be_initial":
      return "inactive_status_cannot_be_initial";
    case "initial_status_must_use_set_initial":
      return "initial_status_must_use_set_initial";
    case "tenant_must_keep_one_active_initial":
      return "El tenant debe conservar un estado inicial activo";
    case "duplicate_status":
      return "Ya existe un estado equivalente";
    case "not_found":
      return "Estado no encontrado";
    case "forbidden":
      return "Unauthorized or tenant access denied";
    case "invalid_value":
      return "Invalid value";
    default:
      return fallback;
  }
}

/** Backend gate for Settings order-status writes (mirrors route checks). */
export function canAccessOrderStatusSettingsApi(
  role: string | null | undefined,
  hasContext: boolean
) {
  if (!hasContext) {
    return false;
  }
  return (
    role === "owner" || role === "admin" || role === "manager"
  );
}
