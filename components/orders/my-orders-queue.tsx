"use client";

import Link from "next/link";
import { EmptyState } from "@/components/gestcopy/empty-state";
import { StatusBadge } from "@/components/gestcopy/status-badge";
import { formatPriority } from "@/lib/orders/format";
import type { MineOrder, MineQueueSection } from "@/lib/orders/mine";
import {
  UNLINKED_MINE_ASSIGN_CTA_LABEL,
  UNLINKED_MINE_DESCRIPTION,
  UNLINKED_MINE_TITLE,
  type UnlinkedMineOrdersCopy,
} from "@/lib/orders/mine-unlinked-copy";
import {
  formatZonedCivilDate,
  formatZonedTime,
} from "@/lib/time/zoned-day";
import { cn } from "@/lib/utils";

function dueLabel(
  dueAt: string | null,
  todayCivil: string,
  timeZone: string
) {
  if (!dueAt) {
    return "Sin entrega";
  }

  const due = new Date(dueAt);
  if (Number.isNaN(due.getTime())) {
    return "Sin entrega";
  }

  const civil = formatZonedCivilDate(due, timeZone);
  const time = formatZonedTime(due, timeZone);

  if (civil === todayCivil) {
    return `Hoy ${time}`;
  }

  return `${new Intl.DateTimeFormat("es-ES", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(due)} ${time}`;
}

function attentionChips(
  order: MineOrder,
  todayCivil: string,
  timeZone: string
) {
  const chips: Array<{ id: string; label: string; tone: "danger" | "warning" | "brand" }> =
    [];

  if (order.due_at) {
    const due = new Date(order.due_at);
    if (!Number.isNaN(due.getTime())) {
      const civil = formatZonedCivilDate(due, timeZone);
      if (civil < todayCivil) {
        chips.push({ id: "overdue", label: "Retrasado", tone: "danger" });
      } else if (civil === todayCivil) {
        chips.push({ id: "due-today", label: "Entrega hoy", tone: "warning" });
      }
    }
  }

  if (order.status?.is_ready) {
    chips.push({ id: "ready", label: "Listo", tone: "brand" });
  }

  return chips;
}

function priorityTone(priority: string): "danger" | "warning" | "neutral" {
  if (priority === "urgent") return "danger";
  if (priority === "high") return "warning";
  return "neutral";
}

export function MyOrdersQueue({
  linked,
  sections,
  today,
  timezone,
  unlinkedCopy,
}: {
  linked: boolean;
  sections: MineQueueSection[];
  today: string;
  timezone: string;
  unlinkedCopy?: UnlinkedMineOrdersCopy;
}) {
  if (!linked) {
    return (
      <div className="overflow-hidden rounded-lg border bg-card">
        <EmptyState
          title={unlinkedCopy?.title ?? UNLINKED_MINE_TITLE}
          description={unlinkedCopy?.description ?? UNLINKED_MINE_DESCRIPTION}
          action={
            unlinkedCopy?.assignCtaHref ? (
              <Link
                href={unlinkedCopy.assignCtaHref}
                className="gc-cta inline-flex h-10 items-center rounded-[var(--radius)] px-5 font-semibold"
              >
                {UNLINKED_MINE_ASSIGN_CTA_LABEL}
              </Link>
            ) : null
          }
        />
      </div>
    );
  }

  if (sections.length === 0) {
    return (
      <div className="overflow-hidden rounded-lg border bg-card">
        <EmptyState title="Ahora mismo no tienes pedidos asignados." />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {sections.map((section) => (
        <section key={section.id} className="space-y-3">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-lg font-semibold tracking-tight">
              {section.label}
            </h2>
            <p className="text-sm text-muted-foreground">
              {section.orders.length}
            </p>
          </div>
          <ul className="space-y-2.5">
            {section.orders.map((order) => (
              <li key={order.id}>
                <MineOrderCard
                  order={order}
                  today={today}
                  timezone={timezone}
                />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function MineOrderCard({
  order,
  today,
  timezone,
}: {
  order: MineOrder;
  today: string;
  timezone: string;
}) {
  const chips = attentionChips(order, today, timezone);

  return (
    <Link
      href={`/orders/${order.id}`}
      className={cn(
        "block min-h-11 rounded-[var(--radius)] border border-border/80 bg-card px-4 py-3.5 shadow-sm transition-colors",
        "hover:border-primary/40 hover:bg-primary/5",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="font-mono text-sm font-semibold tracking-wide">
          {order.reference}
        </p>
        <div className="flex flex-wrap justify-end gap-1.5">
          <StatusBadge tone={priorityTone(order.priority)}>
            {formatPriority(order.priority)}
          </StatusBadge>
          {chips.map((chip) => (
            <StatusBadge key={chip.id} tone={chip.tone}>
              {chip.label}
            </StatusBadge>
          ))}
        </div>
      </div>
      <p className="mt-1.5 text-base font-medium leading-snug">{order.title}</p>
      <p className="mt-1 text-[0.9375rem] text-muted-foreground">
        {order.client_name || "Sin cliente"}
        {order.service_name ? ` · ${order.service_name}` : ""}
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        {order.store_name || "Sin tienda"}
      </p>
      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <StatusBadge status={order.status}>{order.status?.name}</StatusBadge>
        <span className="text-muted-foreground">
          {dueLabel(order.due_at, today, timezone)}
        </span>
      </div>
    </Link>
  );
}
