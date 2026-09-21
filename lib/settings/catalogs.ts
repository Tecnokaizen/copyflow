import {
  nextAvailableStatusCode,
  statusCodeBaseFromName,
} from "@/lib/settings/order-statuses";

export const SETTINGS_CATALOG_KEYS = [
  "customer_types",
  "entry_channels",
  "order_contexts",
  "file_statuses",
  "quote_statuses",
  "payment_statuses",
  "delivery_methods",
  "service_categories",
] as const;

export type SettingsCatalogKey = (typeof SETTINGS_CATALOG_KEYS)[number];

export type SettingsCatalogDefinition = {
  key: SettingsCatalogKey;
  table: SettingsCatalogKey;
  label: string;
  singular: string;
  description: string;
  group: "customers" | "management" | "services";
  hasCode: boolean;
};

export const SETTINGS_CATALOGS: Record<
  SettingsCatalogKey,
  SettingsCatalogDefinition
> = {
  customer_types: {
    key: "customer_types",
    table: "customer_types",
    label: "Tipos de cliente",
    singular: "tipo de cliente",
    description: "Clasificación disponible en las fichas de cliente.",
    group: "customers",
    hasCode: false,
  },
  entry_channels: {
    key: "entry_channels",
    table: "entry_channels",
    label: "Canales de entrada",
    singular: "canal de entrada",
    description: "Origen por el que llega cada pedido: mostrador, teléfono, email, etc.",
    group: "customers",
    hasCode: true,
  },
  order_contexts: {
    key: "order_contexts",
    table: "order_contexts",
    label: "Contextos",
    singular: "contexto",
    description: "Contextos operativos adicionales para clasificar pedidos.",
    group: "customers",
    hasCode: true,
  },
  file_statuses: {
    key: "file_statuses",
    table: "file_statuses",
    label: "Estado de archivos",
    singular: "estado de archivo",
    description: "Situación de los materiales o documentos asociados al pedido.",
    group: "management",
    hasCode: true,
  },
  quote_statuses: {
    key: "quote_statuses",
    table: "quote_statuses",
    label: "Estado de presupuesto",
    singular: "estado de presupuesto",
    description: "Estados del presupuesto dentro del seguimiento del pedido.",
    group: "management",
    hasCode: true,
  },
  payment_statuses: {
    key: "payment_statuses",
    table: "payment_statuses",
    label: "Estado de pago",
    singular: "estado de pago",
    description: "Situación de cobro disponible para cada pedido.",
    group: "management",
    hasCode: true,
  },
  delivery_methods: {
    key: "delivery_methods",
    table: "delivery_methods",
    label: "Métodos de entrega",
    singular: "método de entrega",
    description: "Opciones disponibles para la entrega o recogida del trabajo.",
    group: "management",
    hasCode: true,
  },
  service_categories: {
    key: "service_categories",
    table: "service_categories",
    label: "Categorías de servicio",
    singular: "categoría de servicio",
    description: "Agrupaciones utilizadas para organizar el catálogo de servicios.",
    group: "services",
    hasCode: false,
  },
};

export type SettingsCatalogItem = {
  id: string;
  name: string;
  code: string | null;
  active: boolean;
  sort_order: number;
};

export type SettingsCatalogPayload = {
  name: string;
  active: boolean;
  sort_order: number;
};

export function isSettingsCatalogKey(
  value: unknown
): value is SettingsCatalogKey {
  return (
    typeof value === "string" &&
    SETTINGS_CATALOG_KEYS.includes(value as SettingsCatalogKey)
  );
}

export function parseSettingsCatalogPayload(
  payload: Record<string, unknown>
): { ok: true; data: SettingsCatalogPayload } | { ok: false } {
  const allowed = new Set(["name", "active", "sort_order"]);
  if (Object.keys(payload).some((key) => !allowed.has(key))) {
    return { ok: false };
  }

  if (
    typeof payload.name !== "string" ||
    typeof payload.active !== "boolean"
  ) {
    return { ok: false };
  }

  const name = payload.name.trim();
  if (!name || name.length > 100) {
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
      active: payload.active,
      sort_order: sortOrder,
    },
  };
}

export function mapSettingsCatalogItem(
  row: unknown
): SettingsCatalogItem | null {
  if (!row || typeof row !== "object") {
    return null;
  }

  const record = row as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id : null;
  const name = typeof record.name === "string" ? record.name.trim() : "";

  if (!id || !name) {
    return null;
  }

  const sortRaw = record.sort_order;
  const sortOrder =
    typeof sortRaw === "number"
      ? sortRaw
      : typeof sortRaw === "string"
        ? Number(sortRaw)
        : 0;

  return {
    id,
    name,
    code:
      typeof record.code === "string" && record.code.trim()
        ? record.code.trim()
        : null,
    active: record.active !== false,
    sort_order:
      Number.isFinite(sortOrder) && sortOrder >= 0 ? Math.round(sortOrder) : 0,
  };
}

export function nextAvailableCatalogCode(input: {
  catalog: SettingsCatalogKey;
  name: string;
  existingCodes: Iterable<string>;
}) {
  const reserved = new Set<string>();

  // Kiosk is an explicit feature opt-in. Ordinary entry-channel management
  // must never enable it accidentally just because somebody names a channel
  // "Kiosk".
  if (input.catalog === "entry_channels") {
    reserved.add("kiosk");
  }

  const used = new Set(
    Array.from(input.existingCodes, (code) => code.trim().toLowerCase())
  );
  for (const code of reserved) {
    used.add(code);
  }

  return nextAvailableStatusCode(input.name, used);
}

export { statusCodeBaseFromName };
