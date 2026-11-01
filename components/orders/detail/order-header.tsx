"use client";

import Link from "next/link";
import { StatusBadge } from "@/components/gestcopy/status-badge";
import { OrderQuickActions } from "@/components/orders/detail/order-quick-actions";
import { getOrderAttentionSignals } from "@/lib/orders/attention";
import type { OrderCollection } from "@/lib/orders/collection";
import { formatDate, formatPriority } from "@/lib/orders/format";
import { orderLabels, type OrderLabels } from "@/lib/orders/labels";
import { formatOrderMoney } from "@/lib/orders/money";
import { resolveOrderStatusId } from "@/lib/orders/draft";
import {
  canMutateOrderActions,
} from "@/lib/orders/lifecycle-ux";
import { isOrderArchived } from "@/lib/orders/operational";
import type {
  Order,
  OrderDraft,
  OrderOptionsResponse,
  OrderStatus,
} from "@/lib/orders/types";

const STANDARD_LABELS = orderLabels({ custom: false });

function priorityTone(
  priority: string
): "neutral" | "warning" | "danger" | "brand" {
  if (priority === "urgent") return "danger";
  if (priority === "high") return "warning";
  return "neutral";
}

function headerClient(order: Order) {
  return order.client_id && order.client?.id ? order.client : null;
}

function clientLine(order: Order) {
  const client = headerClient(order);
  if (!client) return "Sin cliente";
  if (client.company_name && client.company_name !== client.name) {
    return `${client.name} · ${client.company_name}`;
  }
  return client.name;
}

// SUR4 E3 (sur4-0134 layout): the three amounts and the delivery date sit on
// the right of the header, visible without scrolling at 390 px. The amounts
// come from the same payments endpoint as «Cobro y entrega», with the same
// permissions: if it can't be read, only the delivery date is shown.
function OrderHeaderFigures({
  labels,
  collection,
  dueAt,
  compact = false,
  className = "",
}: {
  labels: OrderLabels;
  collection: OrderCollection | null;
  dueAt: string | null;
  compact?: boolean;
  className?: string;
}) {
  const money = (value: string | null | undefined) =>
    value ? formatOrderMoney(value) : "Sin definir";
  return (
    <dl
      aria-label="Importes y entrega"
      className={`${
        compact
          ? "grid w-full grid-cols-4 gap-x-2 rounded-[var(--radius)] border border-border bg-card px-3 py-2 text-xs sm:gap-x-4 sm:text-sm lg:w-auto lg:shrink-0"
          : "grid w-full grid-cols-2 gap-x-4 gap-y-2 rounded-[var(--radius)] border border-border bg-card px-4 py-3 text-sm lg:w-80 lg:shrink-0"
      } ${className}`}
    >
      {collection ? (
        <>
          <div className="min-w-0">
            <dt className="text-muted-foreground">{labels.total}</dt>
            <dd className="font-semibold tabular-nums text-foreground">
              {money(collection.total_amount)}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-muted-foreground">{labels.paid}</dt>
            <dd className="font-semibold tabular-nums text-foreground">
              {formatOrderMoney(collection.paid_amount)}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-muted-foreground">{labels.due}</dt>
            <dd
              className={`${
                compact ? "text-sm sm:text-base" : "text-base"
              } font-bold tabular-nums text-foreground`}
            >
              {money(collection.pending_amount)}
            </dd>
          </div>
        </>
      ) : null}
      <div
        className={
          collection
            ? "min-w-0"
            : compact
              ? "col-span-4 min-w-0"
              : "col-span-2 min-w-0"
        }
      >
        <dt className="text-muted-foreground">Entrega</dt>
        <dd
          className={`${
            compact ? "text-sm sm:text-base" : "text-base"
          } font-bold tabular-nums text-foreground`}
        >
          {formatDate(dueAt)}
        </dd>
      </div>
    </dl>
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
  saveBlocked = false,
  onQuickStatus,
  onQuickAssignee,
  onQuickNote,
  onNoteRequest,
  onArchive,
  labels = STANDARD_LABELS,
  collection = null,
  density = "comfortable",
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
  saveBlocked?: boolean;
  onQuickStatus: (statusId: string) => Promise<void>;
  onQuickAssignee: (memberId: string | null) => Promise<void>;
  onQuickNote: (note: string) => Promise<void>;
  /** With Post-its, «Añadir nota» opens the Post-it composer instead. */
  onNoteRequest?: () => void;
  onArchive: () => Promise<void>;
  /** SUR4 (contract §5): names of the amounts. */
  labels?: OrderLabels;
  collection?: OrderCollection | null;
  /**
   * Order Detail Views V1. Same data, actions and permissions in every
   * density; only the arrangement changes:
   * - «compact» (A, D): on phones the quick actions come right after the
   *   title, the amounts fit one row, contact and printing fold away.
   * - «production» (C): like compact, without the amounts in the header
   *   (they stay in «Cobro y entrega»), so the work comes first.
   */
  density?: "comfortable" | "compact" | "production";
}) {
  const lean = density !== "comfortable";
  const showFigures = density !== "production";
  const priority = draft && editing ? draft.priority : order.priority;
  const dueAt = draft && editing ? draft.due_at : order.due_at;
  const title = draft && editing ? draft.title : order.title;
  const statusForBadge =
    (draft && editing
      ? (statuses.find((item) => item.id === draft.status_id) ?? null)
      : order.status) ?? null;
  const archived = isOrderArchived(order);
  const mutate = canMutateOrderActions({
    canWrite,
    archived_at: order.archived_at,
  });

  const signals = getOrderAttentionSignals({
    ...order,
    priority,
    due_at: dueAt,
    assigned_team_member_id: editing
      ? (draft?.assigned_team_member_id ?? null)
      : order.assigned_team_member_id,
  });
  const client = headerClient(order);
  const hasContact = Boolean(
    client &&
      (client.contact_name?.trim() ||
        client.phone?.trim() ||
        client.email?.trim())
  );

  const contact =
    client && hasContact ? (
      <>
        {client.contact_name?.trim() ? (
          <span>Contacto: {client.contact_name}</span>
        ) : null}
        {client.phone?.trim() ? (
          <a
            href={`tel:${client.phone.replace(/\s+/g, "")}`}
            className="underline-offset-4 hover:underline"
          >
            {client.phone}
          </a>
        ) : null}
        {client.email?.trim() ? (
          <a
            href={`mailto:${client.email}`}
            className="break-all underline-offset-4 hover:underline"
          >
            {client.email}
          </a>
        ) : null}
      </>
    ) : null;

  const printLinks = (
    <>
      <Link
        href={`/orders/${order.id}/print`}
        target="_blank"
        rel="noopener noreferrer"
        className="gc-action min-h-11 w-full lg:w-auto"
        title="Hoja de trabajo interna, en A4"
      >
        Imprimir pedido
      </Link>
      <a
        href={`/api/orders/${order.id}/receipt`}
        target="_blank"
        rel="noopener noreferrer"
        className="gc-action min-h-11 w-full lg:w-auto"
        title="Resguardo para el cliente, en PDF"
      >
        Resguardo PDF
      </a>
    </>
  );

  return (
    <header className={lean ? "mb-4 flex flex-col sm:mb-5" : "mb-6 sm:mb-8"}>
      <Link
        href="/orders"
        className={`${lean ? "mb-1 self-start" : "mb-4"} inline-block min-h-11 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground`}
      >
        ← Pedidos
      </Link>

      {/* Lean densities: on phones this wrapper dissolves so the actions
          (order-2) sit between the title (order-1) and the amounts (order-3). */}
      <div
        className={
          lean
            ? "contents lg:order-1 lg:flex lg:flex-row lg:items-center lg:justify-between lg:gap-6"
            : "flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between lg:gap-6"
        }
      >
        <div className={lean ? "order-1 min-w-0" : "min-w-0"}>
          <p className="text-sm font-semibold tracking-wide text-muted-foreground">
            {order.reference}
          </p>
          <h1
            className={
              lean
                ? "mt-0.5 break-words text-xl font-bold tracking-tight text-foreground sm:text-2xl"
                : "mt-1 break-words text-3xl font-bold tracking-tight text-foreground md:text-4xl"
            }
          >
            {title.trim() || "Sin título"}
          </h1>
          <p className={lean ? "mt-1 text-sm text-foreground" : "mt-2 text-base text-foreground"}>
            {clientLine(order)}
          </p>
          {contact ? (
            lean ? (
              <>
                <details className="mt-0.5 text-sm text-muted-foreground sm:hidden">
                  <summary className="inline-flex min-h-9 cursor-pointer items-center underline-offset-4 hover:underline">
                    Contacto
                  </summary>
                  <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1">{contact}</p>
                </details>
                <p className="mt-1 hidden flex-wrap gap-x-3 gap-y-1 text-sm text-muted-foreground sm:flex">
                  {contact}
                </p>
              </>
            ) : (
              <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted-foreground">
                {contact}
              </p>
            )
          ) : null}

          <div className={lean ? "mt-2 flex flex-wrap gap-2" : "mt-4 flex flex-wrap gap-2"}>
            {archived ? (
              <StatusBadge tone="neutral">Archivado</StatusBadge>
            ) : null}
            <StatusBadge status={statusForBadge} />
            <StatusBadge tone={priorityTone(priority)}>
              {formatPriority(priority)}
            </StatusBadge>
            {signals.map((signal) => (
              <StatusBadge key={signal.id} tone={signal.tone}>
                {signal.label}
              </StatusBadge>
            ))}
          </div>
        </div>

        {showFigures ? (
          <OrderHeaderFigures
            labels={labels}
            collection={collection}
            dueAt={dueAt}
            compact={lean}
            className={lean ? "order-3 mt-3 lg:mt-0" : ""}
          />
        ) : null}
      </div>

      <div
        className={`${
          lean ? "order-2 mt-3 lg:order-2" : "mt-5"
        } flex flex-col gap-2 lg:flex-row lg:flex-wrap lg:items-start lg:justify-end`}
      >
        <div className={lean ? "hidden gap-2 lg:flex" : "grid grid-cols-2 gap-2 lg:flex"}>
          {printLinks}
        </div>
        {editing ? (
          <div className="flex flex-col gap-2 lg:items-end">
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
                disabled={saving || saveBlocked}
                onClick={onSave}
                className="gc-cta min-h-11 w-full sm:w-auto disabled:opacity-50"
              >
                {saving ? "Guardando…" : "Guardar cambios"}
              </button>
            </div>
            {clientSavedDuringEdit ? (
              <p className="max-w-xs text-xs text-muted-foreground lg:text-right">
                Cliente ya guardado. Descartar borrador no lo revierte.
              </p>
            ) : null}
          </div>
        ) : mutate ? (
          <OrderQuickActions
            busy={quickSaving}
            statuses={statuses}
            teamMembers={orderOptions?.team_members ?? []}
            optionsLoading={orderOptionsLoading}
            currentStatusId={resolveOrderStatusId(order, statuses)}
            currentStatusName={order.status?.name}
            currentAssigneeId={order.assigned_team_member_id}
            currentAssigneeName={order.assigned_team_member?.name}
            archivedAt={order.archived_at}
            currentStatus={order.status}
            onEdit={onEdit}
            onSaveStatus={onQuickStatus}
            onSaveAssignee={onQuickAssignee}
            onSaveNote={onQuickNote}
            onNoteRequest={onNoteRequest}
            onArchive={onArchive}
            compact={lean}
          />
        ) : null}
        {/* Lean densities, phones: printing folds away below the actions. */}
        {lean ? (
          <details className="lg:hidden">
            <summary className="gc-action min-h-11 w-full cursor-pointer list-none text-center [&::-webkit-details-marker]:hidden">
              Imprimir y resguardo
            </summary>
            <div className="mt-2 grid grid-cols-2 gap-2">{printLinks}</div>
          </details>
        ) : null}
      </div>
    </header>
  );
}
