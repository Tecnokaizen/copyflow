export const QUICK_ORDER_FIELDS = [
  "client",
  "service",
  "description",
  "store",
  "due_at",
  "priority",
  "assigned_team_member",
  "entry_channel",
  "title",
  "order_context",
  "notes",
] as const;

export type QuickOrderField = (typeof QUICK_ORDER_FIELDS)[number];
export type QuickOrderPlacement = "primary" | "more";
export type QuickOrderLayout = Record<
  QuickOrderField,
  QuickOrderPlacement
>;

export const QUICK_ORDER_FIELD_LABELS: Record<QuickOrderField, string> = {
  client: "Cliente",
  service: "Servicio",
  description: "Descripción",
  store: "Tienda",
  due_at: "Entrega prevista",
  priority: "Prioridad",
  assigned_team_member: "Responsable",
  entry_channel: "Canal de entrada",
  title: "Nombre del pedido",
  order_context: "Contexto",
  notes: "Notas internas",
};

export const DEFAULT_QUICK_ORDER_LAYOUT: QuickOrderLayout = {
  client: "primary",
  service: "primary",
  description: "primary",
  store: "primary",
  due_at: "primary",
  priority: "primary",
  assigned_team_member: "primary",
  entry_channel: "more",
  title: "more",
  order_context: "more",
  notes: "more",
};

const FIELD_SET = new Set<string>(QUICK_ORDER_FIELDS);

export function canManageQuickOrderLayout(
  role: string | null | undefined
): boolean {
  return role === "owner";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseLayout(value: unknown): QuickOrderLayout | null {
  if (!isRecord(value)) {
    return null;
  }

  const keys = Object.keys(value);
  if (
    keys.length !== QUICK_ORDER_FIELDS.length ||
    keys.some((key) => !FIELD_SET.has(key))
  ) {
    return null;
  }

  for (const field of QUICK_ORDER_FIELDS) {
    if (value[field] !== "primary" && value[field] !== "more") {
      return null;
    }
  }

  return Object.fromEntries(
    QUICK_ORDER_FIELDS.map((field) => [field, value[field]])
  ) as QuickOrderLayout;
}

export function resolveQuickOrderLayout(
  preferences: unknown
): QuickOrderLayout {
  if (!isRecord(preferences)) {
    return { ...DEFAULT_QUICK_ORDER_LAYOUT };
  }

  const stored = preferences.quick_order_layout_v1;
  if (
    !isRecord(stored) ||
    stored.version !== 1 ||
    !isRecord(stored.placements)
  ) {
    return { ...DEFAULT_QUICK_ORDER_LAYOUT };
  }

  return parseLayout(stored.placements) ?? { ...DEFAULT_QUICK_ORDER_LAYOUT };
}

export function fieldsForPlacement(
  layout: QuickOrderLayout,
  placement: QuickOrderPlacement
): QuickOrderField[] {
  return QUICK_ORDER_FIELDS.filter((field) => layout[field] === placement);
}

export function parseQuickOrderLayoutPatch(
  value: unknown
):
  | { ok: true; layout: QuickOrderLayout; revision: string }
  | { ok: false } {
  if (!isRecord(value)) {
    return { ok: false };
  }

  const keys = Object.keys(value);
  if (
    keys.length !== 2 ||
    !keys.includes("layout") ||
    !keys.includes("revision") ||
    typeof value.revision !== "string" ||
    !value.revision.trim()
  ) {
    return { ok: false };
  }

  const layout = parseLayout(value.layout);
  if (!layout) {
    return { ok: false };
  }

  return {
    ok: true,
    layout,
    revision: value.revision.trim(),
  };
}

export function mergeQuickOrderLayoutPreference(
  preferences: unknown,
  layout: QuickOrderLayout
): Record<string, unknown> {
  const current = isRecord(preferences) ? preferences : {};

  return {
    ...current,
    quick_order_layout_v1: {
      version: 1,
      placements: { ...layout },
    },
  };
}
