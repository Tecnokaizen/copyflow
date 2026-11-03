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
      "Cabecera compacta: resumen, trabajo y archivos agrupados; cobro y entrega al lado, secuencia y notas debajo.",
  },
  tabs: {
    code: "tabs",
    letter: "B",
    name: "Pestañas",
    summary:
      "Cuatro secciones sin fragmentar la ficha: Trabajo (resumen y archivos), Cobro y entrega, Post-its y Secuencia de trabajo.",
  },
  production: {
    code: "production",
    letter: "C",
    name: "Producción",
    summary:
      "Prioriza secuencia y producción; agrupa resumen, trabajo y archivos y deja cobro y entrega plegado.",
  },
  hybrid: {
    code: "hybrid",
    letter: "D",
    name: "Híbrida",
    summary:
      "Tablero, secuencia y post-its destacados; resumen, trabajo y archivos juntos, con cobro y entrega separado.",
  },
};

// Views a tenant can preview, apply and use (03/11/2026: only B and C).
// The classic page is not offered but stays as the technical fallback: any
// other stored value, including a retired view, resolves to it. Retired
// layouts keep their code and are never deleted from stored preferences.
export const IMPLEMENTED_ORDER_DETAIL_VIEWS: readonly OrderDetailViewCode[] = [
  "tabs",
  "production",
];

/** Views withdrawn from the selector; a tenant that still has one stored is told so in Settings. */
export const RETIRED_ORDER_DETAIL_VIEWS: readonly OrderDetailViewCode[] = [
  "operational",
  "hybrid",
];

export function isRetiredOrderDetailView(value: unknown): value is OrderDetailViewCode {
  return isOrderDetailViewCode(value) && RETIRED_ORDER_DETAIL_VIEWS.includes(value);
}

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
