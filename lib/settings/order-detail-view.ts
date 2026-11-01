import {
  IMPLEMENTED_ORDER_DETAIL_VIEWS,
  ORDER_DETAIL_VIEW_PREFERENCE_KEY,
  isImplementedOrderDetailView,
  readStoredOrderDetailView,
  resolveOrderDetailView,
  type OrderDetailViewCode,
  type StoredOrderDetailView,
} from "@/lib/orders/detail-views";
import {
  revisionsMatch,
  serializeSettingsRevision,
} from "@/lib/settings/quick-order-layout";

export { canManageOrderDetailView } from "@/lib/orders/detail-views";
export { serializeSettingsRevision };

// Order Detail Views V1 — tenant preference in tenant_settings.preferences.
// Writes: owner/admin (server check + RLS tenant_settings_update_owner_admin),
// merge with every other preference, optimistic concurrency on updated_at.

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export type OrderDetailViewState = {
  view: OrderDetailViewCode;
  previousView: OrderDetailViewCode | null;
  updatedAt: string | null;
  revision: string;
};

export function orderDetailViewState(
  preferences: unknown,
  updatedAt: unknown
): OrderDetailViewState {
  const stored = readStoredOrderDetailView(preferences);
  const previous =
    stored?.previous_view &&
    isImplementedOrderDetailView(stored.previous_view)
      ? stored.previous_view
      : null;
  return {
    view: resolveOrderDetailView(preferences),
    previousView: previous,
    updatedAt: stored?.updated_at ?? null,
    revision: serializeSettingsRevision(updatedAt),
  };
}

export function parseOrderDetailViewPatch(
  value: unknown
):
  | { ok: true; view: OrderDetailViewCode; revision: string }
  | { ok: false } {
  if (!isRecord(value)) return { ok: false };
  const keys = Object.keys(value);
  if (keys.some((key) => key !== "view" && key !== "revision")) {
    return { ok: false };
  }
  if (
    !isImplementedOrderDetailView(value.view, IMPLEMENTED_ORDER_DETAIL_VIEWS) ||
    typeof value.revision !== "string" ||
    !value.revision.trim()
  ) {
    return { ok: false };
  }
  return { ok: true, view: value.view, revision: value.revision.trim() };
}

/** New preferences: every other key untouched, previous view remembered. */
export function mergeOrderDetailViewPreference(input: {
  currentPreferences: unknown;
  view: OrderDetailViewCode;
  userId: string;
  now: Date;
}): Record<string, unknown> {
  const current = isRecord(input.currentPreferences)
    ? input.currentPreferences
    : {};
  const appliedNow = resolveOrderDetailView(current);
  const stored = readStoredOrderDetailView(current);
  const next: StoredOrderDetailView = {
    version: 1,
    view: input.view,
    previous_view:
      appliedNow === input.view ? (stored?.previous_view ?? null) : appliedNow,
    updated_at: input.now.toISOString(),
    updated_by: input.userId,
  };
  return { ...current, [ORDER_DETAIL_VIEW_PREFERENCE_KEY]: next };
}

export function planOrderDetailViewUpdate(input: {
  currentUpdatedAt: string | null | undefined;
  submittedRevision: string;
  currentPreferences: unknown;
  view: OrderDetailViewCode;
  userId: string;
  now: Date;
}):
  | { ok: false; status: 409; error: "Order detail view changed" }
  | { ok: true; preferences: Record<string, unknown> } {
  const currentRevision = serializeSettingsRevision(input.currentUpdatedAt);
  if (!revisionsMatch(currentRevision, input.submittedRevision)) {
    return { ok: false, status: 409, error: "Order detail view changed" };
  }
  return {
    ok: true,
    preferences: mergeOrderDetailViewPreference({
      currentPreferences: input.currentPreferences,
      view: input.view,
      userId: input.userId,
      now: input.now,
    }),
  };
}

export function userFacingOrderDetailViewSaveError(status: number): string | null {
  if (status === 200) return null;
  if (status === 409) {
    return "Otra persona ha cambiado la vista mientras tanto. Se ha cargado la configuración actual; revísala y vuelve a aplicar si quieres.";
  }
  if (status === 403) return "Solo el propietario o un administrador pueden cambiar la vista.";
  if (status === 400) return "Esa vista no está disponible.";
  return "No se pudo guardar la vista. Inténtalo de nuevo.";
}
