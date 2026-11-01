// Order Detail Views V1: which layout of the order page a tenant uses.
// Presentation only: every view shows the same modules, actions and
// permissions. The current page («classic») is the fallback for any missing,
// invalid or not-yet-available value.

export const ORDER_DETAIL_VIEW_CODES = [
  "classic",
  "operational",
  "tabs",
  "production",
  "hybrid",
] as const;

export type OrderDetailViewCode = (typeof ORDER_DETAIL_VIEW_CODES)[number];

export const DEFAULT_ORDER_DETAIL_VIEW: OrderDetailViewCode = "classic";

export const ORDER_DETAIL_VIEW_PREFERENCE_KEY = "order_detail_view_v1";

export type OrderDetailViewInfo = {
  code: OrderDetailViewCode;
  letter: "A" | "B" | "C" | "D" | null;
  name: string;
  summary: string;
};

export const ORDER_DETAIL_VIEWS: Record<OrderDetailViewCode, OrderDetailViewInfo> = {
  classic: {
    code: "classic",
    letter: null,
    name: "Ficha actual",
    summary:
      "La ficha de siempre: cabecera completa y dos columnas con trabajo, archivos, resumen y cobro.",
  },
  operational: {
    code: "operational",
    letter: "A",
    name: "Operativa",
    summary:
      "Compacta y con todo a mano: cabecera reducida, trabajo y archivos en el centro, cobro y resumen siempre visibles al lado.",
  },
  tabs: {
    code: "tabs",
    letter: "B",
    name: "Pestañas",
    summary:
      "Cabecera fija con lo importante y una sección cada vez: Resumen, Trabajo, Archivos, Cobros y Actividad.",
  },
  production: {
    code: "production",
    letter: "C",
    name: "Producción",
    summary:
      "Pensada para el taller: estado, responsable, entrega, secuencia y post-its primero; la parte administrativa, plegada.",
  },
  hybrid: {
    code: "hybrid",
    letter: "D",
    name: "Híbrida",
    summary:
      "La operativa con la secuencia y los post-its destacados arriba: gestión y producción en equilibrio.",
  },
};

// Views that are fully built. Only these can be previewed or applied; any
// other stored value resolves to the classic page. The settings selector only
// offers a view listed here.
export const IMPLEMENTED_ORDER_DETAIL_VIEWS: readonly OrderDetailViewCode[] = [
  "classic",
  "operational",
  "tabs",
  "production",
  "hybrid",
];

export function isOrderDetailViewCode(value: unknown): value is OrderDetailViewCode {
  return (
    typeof value === "string" &&
    (ORDER_DETAIL_VIEW_CODES as readonly string[]).includes(value)
  );
}

export function isImplementedOrderDetailView(
  value: unknown,
  implemented: readonly OrderDetailViewCode[] = IMPLEMENTED_ORDER_DETAIL_VIEWS
): value is OrderDetailViewCode {
  return isOrderDetailViewCode(value) && implemented.includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export type StoredOrderDetailView = {
  version: 1;
  view: OrderDetailViewCode;
  previous_view: OrderDetailViewCode | null;
  updated_at: string | null;
  updated_by: string | null;
};

/** Reads the stored preference; null when absent or malformed. */
export function readStoredOrderDetailView(
  preferences: unknown
): StoredOrderDetailView | null {
  if (!isRecord(preferences)) return null;
  const stored = preferences[ORDER_DETAIL_VIEW_PREFERENCE_KEY];
  if (!isRecord(stored) || stored.version !== 1) return null;
  if (!isOrderDetailViewCode(stored.view)) return null;
  return {
    version: 1,
    view: stored.view,
    previous_view: isOrderDetailViewCode(stored.previous_view)
      ? stored.previous_view
      : null,
    updated_at: typeof stored.updated_at === "string" ? stored.updated_at : null,
    updated_by: typeof stored.updated_by === "string" ? stored.updated_by : null,
  };
}

/** The view a tenant's order page uses. Never throws; falls back to classic. */
export function resolveOrderDetailView(
  preferences: unknown,
  implemented: readonly OrderDetailViewCode[] = IMPLEMENTED_ORDER_DETAIL_VIEWS
): OrderDetailViewCode {
  const stored = readStoredOrderDetailView(preferences);
  if (!stored || !implemented.includes(stored.view)) {
    return DEFAULT_ORDER_DETAIL_VIEW;
  }
  return stored.view;
}

export function canManageOrderDetailView(role: string | null | undefined): boolean {
  return role === "owner" || role === "admin";
}

export const ORDER_DETAIL_VIEW_PREVIEW_PARAM = "vista";

/**
 * Preview without saving: `?vista=<code>` on the order page. Only owner and
 * admin, only implemented views. Everyone else always gets the tenant's view.
 */
export function resolvePreviewOrderDetailView(input: {
  requested: string | null | undefined;
  role: string | null | undefined;
  implemented?: readonly OrderDetailViewCode[];
}): OrderDetailViewCode | null {
  if (!input.requested || !canManageOrderDetailView(input.role)) return null;
  return isImplementedOrderDetailView(input.requested, input.implemented)
    ? input.requested
    : null;
}
