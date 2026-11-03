import type { ActivityItem, Order, OrderStatus } from "./types";

/** visited = the history shows the order was in this state at some point.
 * It never means the step is still done: the order may have gone back since. */
export type TrackingState = "visited" | "current" | "pending" | "unconfirmed";

export const TRACKING_STATE_LABELS: Record<TrackingState, string> = {
  visited: "Pasó por este estado",
  current: "Estado actual",
  pending: "Pendiente",
  unconfirmed: "Sin registro",
};

export type TrackingStep = {
  id: string;
  name: string;
  state: TrackingState;
  enteredAt: string | null;
  inactive: boolean;
  /** Shown after the current step in the catalogue order. Display only:
   * a visited step here must not look completed (e.g. after a reopening). */
  beyondCurrent: boolean;
};

type TrackingOrder = Pick<Order, "id" | "status_id" | "status">;
type Evidence = { name: string | null; enteredAt: string | null };

function validDate(value: string): string | null {
  return Number.isFinite(Date.parse(value)) ? value : null;
}

/** Catalogue order is a display preference, never proof of a transition.
 * Only this order's creation/status audit events prove that a step was visited.
 * A previous_values snapshot proves presence, but not the time of entry.
 * Sticky ready_at/delivered_at and due_at cannot date a configurable state.
 */
export function buildOrderTracking(
  order: TrackingOrder,
  statuses: OrderStatus[],
  activity: ActivityItem[]
): TrackingStep[] {
  const evidence = new Map<string, Evidence>();
  const events = activity
    .filter((event) => event.entity_type === "order" && event.entity_id === order.id &&
      (event.action === "order.created" || event.action === "order.status_changed"))
    .slice()
    .sort((a, b) => (Date.parse(a.created_at) || 0) - (Date.parse(b.created_at) || 0));
  let lastRecordedStatus: string | null = null;

  for (const event of events) {
    if (event.action === "order.status_changed") {
      const previous = event.previous_values;
      if (previous?.status_id && !evidence.has(previous.status_id)) {
        evidence.set(previous.status_id, {
          name: previous.status_name ?? null,
          enteredAt: null,
        });
      }
    }
    const next = event.new_values;
    lastRecordedStatus = next?.status_id ?? null;
    if (next?.status_id) {
      evidence.set(next.status_id, {
        name: next.status_name ?? evidence.get(next.status_id)?.name ?? null,
        enteredAt: validDate(event.created_at),
      });
    }
  }

  const catalogue = statuses.slice().sort((a, b) =>
    (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.name.localeCompare(b.name, "es") || a.id.localeCompare(b.id)
  );
  const candidates = catalogue.filter((status) =>
    status.id === order.status_id || evidence.has(status.id) ||
    (status.active !== false && !status.is_cancelled)
  );
  // Retain historical states even if they are no longer in the catalogue.
  for (const [id, visit] of evidence) {
    if (!candidates.some((status) => status.id === id)) {
      candidates.push({ id, code: "", name: visit.name || "Estado histórico", active: false });
    }
  }
  const currentId = order.status_id ?? "undefined-current-status";
  if (!candidates.some((status) => status.id === currentId)) {
    candidates.push({ id: currentId, code: order.status?.code ?? "", name: order.status?.name ?? "Estado sin definir" });
  }
  const currentIndex = candidates.findIndex((status) => status.id === currentId);
  const terminal = order.status?.is_cancelled === true || order.status?.is_closed === true;

  return candidates.map((status, index) => {
    const current = status.id === currentId;
    const visit = evidence.get(status.id);
    return {
      id: status.id,
      name: current ? order.status?.name ?? status.name : status.name,
      state: current ? "current" : visit ? "visited" : index < currentIndex || terminal ? "unconfirmed" : "pending",
      // During separate order/activity refreshes, never attach an old visit's
      // timestamp to a newly selected current status.
      enteredAt: current && lastRecordedStatus !== order.status_id ? null : visit?.enteredAt ?? null,
      inactive: status.active === false,
      beyondCurrent: index > currentIndex,
    };
  });
}
