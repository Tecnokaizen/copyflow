import Link from "next/link";
import { StatusBadge } from "@/components/gestcopy/status-badge";
import { getOrderAttentionSignals } from "@/lib/orders/attention";
import { formatDate, formatPriority } from "@/lib/orders/format";
import type {
  Order,
  OrderDraft,
  OrderOptionsResponse,
  OrderStatus,
} from "@/lib/orders/types";

function priorityTone(
  priority: string
): "neutral" | "warning" | "danger" | "brand" {
  if (priority === "urgent") return "danger";
  if (priority === "high") return "warning";
  return "neutral";
}

function clientLine(order: Order) {
  const client = order.client_id && order.client?.id ? order.client : null;
  if (!client) return "Sin cliente";
  if (client.company_name && client.company_name !== client.name) {
    return `${client.name} · ${client.company_name}`;
  }
  return client.name;
}

function resolveAssigneeName(
  order: Order,
  draft: OrderDraft | null,
  options: OrderOptionsResponse | null
) {
  const id = draft?.assigned_team_member_id ?? order.assigned_team_member_id;
  if (!id) return "Sin responsable";
  if (id === order.assigned_team_member_id && order.assigned_team_member?.name) {
    return order.assigned_team_member.name;
  }
  return (
    options?.team_members.find((item) => item.id === id)?.name ??
    "Sin responsable"
  );
}

export function OrderHeader({
  order,
  draft,
  editing,
  canWrite,
  saving,
  clientSavedDuringEdit,
  statuses,
  orderOptions,
  onEdit,
  onCancel,
  onSave,
}: {
  order: Order;
  draft: OrderDraft | null;
  editing: boolean;
  canWrite: boolean;
  saving: boolean;
  clientSavedDuringEdit: boolean;
  statuses: OrderStatus[];
  orderOptions: OrderOptionsResponse | null;
  onEdit: () => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const priority = draft && editing ? draft.priority : order.priority;
  const dueAt = draft && editing ? draft.due_at : order.due_at;
  const title = draft && editing ? draft.title : order.title;
  const statusForBadge =
    (draft && editing
      ? (statuses.find((item) => item.id === draft.status_id) ?? null)
      : order.status) ?? null;

  const signals = getOrderAttentionSignals({
    ...order,
    priority,
    due_at: dueAt,
  });

  return (
    <header className="mb-8 sm:mb-10">
      <Link
        href="/orders"
        className="mb-4 inline-block text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        ← Pedidos
      </Link>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
        <div className="min-w-0">
          <p className="text-sm font-semibold tracking-wide text-muted-foreground">
            {order.reference}
          </p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight text-foreground md:text-4xl">
            {title.trim() || "Sin título"}
          </h1>
          <p className="mt-2 text-base text-muted-foreground">
            {clientLine(order)}
          </p>
        </div>

        <div className="flex shrink-0 flex-col items-stretch gap-2 sm:items-end sm:pt-1">
          {editing ? (
            <>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <button
                  type="button"
                  disabled={saving}
                  onClick={onCancel}
                  title="Descarta solo el borrador del pedido. Los cambios de cliente ya confirmados no se revierten."
                  className="gc-action disabled:opacity-50"
                >
                  Descartar borrador
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={onSave}
                  className="gc-cta disabled:opacity-50"
                >
                  {saving ? "Guardando…" : "Guardar cambios"}
                </button>
              </div>
              {clientSavedDuringEdit ? (
                <p className="max-w-xs text-right text-xs text-muted-foreground">
                  Cliente ya guardado. Descartar borrador no lo revierte.
                </p>
              ) : null}
            </>
          ) : canWrite ? (
            <button type="button" onClick={onEdit} className="gc-cta">
              Editar pedido
            </button>
          ) : null}
        </div>
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        <StatusBadge status={statusForBadge} />
        <StatusBadge tone={priorityTone(priority)}>
          {formatPriority(priority)}
        </StatusBadge>
        <StatusBadge tone="neutral">
          {resolveAssigneeName(order, editing ? draft : null, orderOptions)}
        </StatusBadge>
        <StatusBadge tone="neutral">Entrega {formatDate(dueAt)}</StatusBadge>
      </div>

      {signals.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {signals.map((signal) => (
            <StatusBadge key={signal.id} tone={signal.tone}>
              {signal.label}
            </StatusBadge>
          ))}
        </div>
      ) : null}
    </header>
  );
}
