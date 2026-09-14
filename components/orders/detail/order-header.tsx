"use client";

import Link from "next/link";
import { StatusBadge } from "@/components/gestcopy/status-badge";
import { OrderQuickActions } from "@/components/orders/detail/order-quick-actions";
import { getOrderAttentionSignals } from "@/lib/orders/attention";
import { formatDate, formatPriority } from "@/lib/orders/format";
import { resolveOrderStatusId } from "@/lib/orders/draft";
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
  quickSaving,
  clientSavedDuringEdit,
  statuses,
  orderOptions,
  orderOptionsLoading,
  onEdit,
  onCancel,
  onSave,
  onQuickStatus,
  onQuickAssignee,
  onQuickNote,
}: {
  order: Order;
  draft: OrderDraft | null;
  editing: boolean;
  canWrite: boolean;
  saving: boolean;
  quickSaving: boolean;
  clientSavedDuringEdit: boolean;
  statuses: OrderStatus[];
  orderOptions: OrderOptionsResponse | null;
  orderOptionsLoading: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSave: () => void;
  onQuickStatus: (statusId: string) => Promise<void>;
  onQuickAssignee: (memberId: string | null) => Promise<void>;
  onQuickNote: (note: string) => Promise<void>;
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
    assigned_team_member_id: editing
      ? (draft?.assigned_team_member_id ?? null)
      : order.assigned_team_member_id,
  });

  return (
    <header className="mb-8 sm:mb-10">
      <Link
        href="/orders"
        className="mb-4 inline-block min-h-11 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
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
          <p className="mt-3 text-lg font-semibold tabular-nums tracking-tight text-foreground">
            Entrega {formatDate(dueAt)}
          </p>
        </div>

        <div className="flex w-full shrink-0 flex-col items-stretch gap-2 sm:w-auto sm:items-end sm:pt-1">
          {editing ? (
            <>
              <div className="flex w-full flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
                <button
                  type="button"
                  disabled={saving}
                  onClick={onCancel}
                  title="Descarta solo el borrador del pedido. Los cambios de cliente ya confirmados no se revierten."
                  className="gc-action min-h-11 w-full sm:w-auto disabled:opacity-50"
                >
                  Descartar borrador
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={onSave}
                  className="gc-cta min-h-11 w-full sm:w-auto disabled:opacity-50"
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
            <OrderQuickActions
              busy={quickSaving}
              statuses={statuses}
              teamMembers={orderOptions?.team_members ?? []}
              optionsLoading={orderOptionsLoading}
              currentStatusId={resolveOrderStatusId(order, statuses)}
              currentAssigneeId={order.assigned_team_member_id}
              onEdit={onEdit}
              onSaveStatus={onQuickStatus}
              onSaveAssignee={onQuickAssignee}
              onSaveNote={onQuickNote}
            />
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
