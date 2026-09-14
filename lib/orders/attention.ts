import type { Order } from "@/lib/orders/types";

export type AttentionSignal = {
  id: string;
  label: string;
  tone: "danger" | "warning" | "brand" | "neutral";
};

function startOfLocalDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function isReadyForDelivery(order: Order) {
  const readyFlag = order.status?.is_ready;
  if (typeof readyFlag === "boolean") {
    return readyFlag === true && order.delivered_at === null;
  }

  return order.ready_at !== null && order.delivered_at === null;
}

/**
 * Fixed-semantics attention chips only (no tenant catalog codes).
 * Priority is shown in the header badges — do not duplicate it here.
 * Unassigned is flagged here because it is a shop-floor warning, not a catalog code.
 */
export function getOrderAttentionSignals(order: Order): AttentionSignal[] {
  const signals: AttentionSignal[] = [];

  if (order.due_at) {
    const due = new Date(order.due_at);
    if (!Number.isNaN(due.getTime()) && order.delivered_at === null) {
      const today = startOfLocalDay(new Date());
      const dueDay = startOfLocalDay(due);

      if (dueDay.getTime() < today.getTime()) {
        signals.push({ id: "overdue", label: "Retrasado", tone: "danger" });
      } else if (dueDay.getTime() === today.getTime()) {
        signals.push({
          id: "due-today",
          label: "Entrega hoy",
          tone: "warning",
        });
      }
    }
  }

  const isClosed =
    order.status?.is_closed === true || order.status?.is_cancelled === true;

  if (
    !order.assigned_team_member_id &&
    order.delivered_at === null &&
    !isClosed
  ) {
    signals.push({
      id: "unassigned",
      label: "Sin responsable",
      tone: "warning",
    });
  }

  if (isReadyForDelivery(order)) {
    signals.push({
      id: "ready",
      label: "Listo para entregar",
      tone: "brand",
    });
  }

  return signals;
}
