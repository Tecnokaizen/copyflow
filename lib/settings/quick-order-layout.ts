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
  "file_status",
  "files",
] as const;

export type QuickOrderField = (typeof QUICK_ORDER_FIELDS)[number];
export type QuickOrderPlacement = "primary" | "more" | "hidden";
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
  file_status: "Estado de archivos",
  files: "Archivos adjuntos",
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
  file_status: "more",
  files: "more",
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
  if (keys.some((key) => !FIELD_SET.has(key))) {
    return null;
  }

  // Additive V1 extension: old tenants/clients omit the two new fields.
  const normalized = { ...value };
  for (const field of ["file_status", "files"] as const) {
    if (!(field in normalized)) {
      normalized[field] = DEFAULT_QUICK_ORDER_LAYOUT[field];
    }
  }
  for (const field of QUICK_ORDER_FIELDS) {
    if (
      normalized[field] !== "primary" &&
      normalized[field] !== "more" &&
      normalized[field] !== "hidden"
    ) {
      return null;
    }
  }

  return Object.fromEntries(
    QUICK_ORDER_FIELDS.map((field) => [field, normalized[field]])
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
  layout: Partial<QuickOrderLayout>,
  placement: QuickOrderPlacement
): QuickOrderField[] {
  return QUICK_ORDER_FIELDS.filter((field) => layout[field] === placement);
}

export function layoutsEqual(
  left: QuickOrderLayout,
  right: QuickOrderLayout
): boolean {
  return QUICK_ORDER_FIELDS.every((field) => left[field] === right[field]);
}

export const layoutsMatch = layoutsEqual;

export function placementFromChecked(checked: boolean): QuickOrderPlacement {
  return checked ? "primary" : "more";
}

export function layoutFromCheckedFields(
  checked: Iterable<QuickOrderField>
): QuickOrderLayout {
  const selected = new Set(checked);

  return Object.fromEntries(
    QUICK_ORDER_FIELDS.map((field) => [
      field,
      placementFromChecked(selected.has(field)),
    ])
  ) as QuickOrderLayout;
}

export function toggleQuickOrderField(
  layout: QuickOrderLayout,
  field: QuickOrderField,
  checked: boolean
): QuickOrderLayout {
  return {
    ...layout,
    [field]: placementFromChecked(checked),
  };
}

function parseSettingsRevisionMs(value: string): number {
  const trimmed = value.trim();
  if (!trimmed) {
    return Number.NaN;
  }

  const candidates = [trimmed];
  if (!trimmed.includes("T") && trimmed.includes(" ")) {
    candidates.push(trimmed.replace(" ", "T"));
  }

  for (const candidate of candidates) {
    const direct = Date.parse(candidate);
    if (!Number.isNaN(direct)) {
      return direct;
    }

    const withColonOffset = candidate.replace(/([+-]\d{2})$/, "$1:00");
    if (withColonOffset !== candidate) {
      const parsed = Date.parse(withColonOffset);
      if (!Number.isNaN(parsed)) {
        return parsed;
      }
    }
  }

  return Number.NaN;
}

export function sameSettingsRevision(left: string, right: string): boolean {
  const leftTime = parseSettingsRevisionMs(left);
  const rightTime = parseSettingsRevisionMs(right);

  if (!Number.isNaN(leftTime) && !Number.isNaN(rightTime)) {
    return leftTime === rightTime;
  }

  return left === right;
}

export function revisionsMatch(
  left: string | null | undefined,
  right: string | null | undefined
): boolean {
  if (!left || !right) {
    return false;
  }

  return sameSettingsRevision(left, right);
}

export function serializeSettingsRevision(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = parseSettingsRevisionMs(value);
    if (!Number.isNaN(parsed)) {
      return new Date(parsed).toISOString();
    }

    return value.trim();
  }

  return String(value ?? "");
}

export function userFacingQuickOrderLayoutSaveError(
  status: number
): string | null {
  if (status === 200 || status === 204) {
    return null;
  }

  if (status === 409) {
    return "La configuración cambió en otra sesión. Se ha cargado la versión más reciente.";
  }

  if (status === 403) {
    return "No tienes permiso para guardar esta configuración.";
  }

  if (status === 400) {
    return "No se pudo guardar porque los datos no son válidos.";
  }

  return "No se pudo guardar la configuración. Inténtalo de nuevo.";
}

export function planQuickOrderLayoutUpdate(input: {
  currentUpdatedAt: string | null | undefined;
  submittedRevision: string;
  currentPreferences: unknown;
  layout: QuickOrderLayout;
  now: Date;
}):
  | { ok: false; status: 409; error: "Quick order settings changed" }
  | {
      ok: true;
      values: { preferences: Record<string, unknown>; updated_at: string };
      filters: { tenant_id: true };
    } {
  const currentRevision = serializeSettingsRevision(input.currentUpdatedAt);

  if (!revisionsMatch(currentRevision, input.submittedRevision)) {
    return {
      ok: false,
      status: 409,
      error: "Quick order settings changed",
    };
  }

  return {
    ok: true,
    values: {
      preferences: mergeQuickOrderLayoutPreference(
        input.currentPreferences,
        input.layout
      ),
      updated_at: input.now.toISOString(),
    },
    filters: { tenant_id: true },
  };
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
