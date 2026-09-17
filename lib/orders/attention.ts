import { isOrderOperational } from "@/lib/orders/operational";
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
  if (!isOrderOperational(order)) {
    return false;
  }

  const readyFlag = order.status?.is_ready;
  if (typeof readyFlag === "boolean") {
    return readyFlag === true;
  }

  return order.ready_at !== null;
}

/**
 * Fixed-semantics attention chips only (no tenant catalog codes).
 * Priority is shown in the header badges — do not duplicate it here.
 * Unassigned is flagged here because it is a shop-floor warning, not a catalog code.
 * Operational activity uses the shared predicate (not delivered_at).
 */
export function getOrderAttentionSignals(order: Order): AttentionSignal[] {
  const signals: AttentionSignal[] = [];
  const operational = isOrderOperational(order);

  if (operational && order.due_at) {
    const due = new Date(order.due_at);
    if (!Number.isNaN(due.getTime())) {
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

  if (operational && !order.assigned_team_member_id) {
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
