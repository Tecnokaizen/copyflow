"use client";

import Link from "next/link";
import { EmptyState } from "@/components/gestcopy/empty-state";
import { StatusBadge } from "@/components/gestcopy/status-badge";
import { formatPriority } from "@/lib/orders/format";
import {
  counterEmptyState,
  isOverdueCounterOrder,
  isUrgentCounterOrder,
  type CounterBucket,
  type CounterOrder,
  type CounterViewMode,
} from "@/lib/orders/counter";
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

function priorityTone(priority: string): "danger" | "warning" | "neutral" {
  if (priority === "urgent") return "danger";
  if (priority === "high") return "warning";
  return "neutral";
}

function cardAccentClass(order: CounterOrder, today: string, timezone: string) {
  if (isOverdueCounterOrder(order, today, timezone)) {
    return "border-l-[3px] border-l-[hsl(var(--gc-danger))]";
  }
  if (isUrgentCounterOrder(order)) {
    return "border-l-[3px] border-l-[hsl(var(--gc-urgent))]";
  }
  return "";
}

export function CounterBoard({
  buckets,
  today,
  timezone,
  view = "list",
  filtersActive = false,
  filteredCount,
}: {
  buckets: CounterBucket[];
  today: string;
  timezone: string;
  view?: CounterViewMode;
  filtersActive?: boolean;
  filteredCount?: number;
}) {
  const bucketVisibleCount = buckets.reduce(
    (sum, bucket) => sum + bucket.count,
    0
  );
  const emptyTitle = counterEmptyState({
    filteredCount: filteredCount ?? bucketVisibleCount,
    bucketVisibleCount,
    filtersActive,
  });

  if (emptyTitle) {
    return (
      <div className="overflow-hidden rounded-lg border bg-card">
        <EmptyState title={emptyTitle} />
      </div>
    );
  }

  const visibleBuckets = buckets.filter(
    (bucket) => bucket.id !== "other_active" || bucket.count > 0
  );

  return (
    <div className="space-y-8">
      {visibleBuckets.map((bucket) => (
        <section key={bucket.id} className="space-y-3">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-lg font-semibold tracking-tight">
              {bucket.label}
            </h2>
            <p className="text-sm text-muted-foreground">{bucket.count}</p>
          </div>
          {bucket.orders.length === 0 ? (
            <p className="rounded-[var(--radius)] border border-dashed border-border/80 px-4 py-5 text-sm text-muted-foreground">
              Ninguno ahora.
            </p>
          ) : view === "grid" ? (
            <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {bucket.orders.map((order) => (
                <li key={`${bucket.id}-${order.id}`}>
                  <CounterOrderCard
                    order={order}
                    today={today}
                    timezone={timezone}
                    variant="grid"
                  />
                </li>
              ))}
            </ul>
          ) : (
            <ul className="space-y-2.5">
              {bucket.orders.map((order) => (
                <li key={`${bucket.id}-${order.id}`}>
                  <CounterOrderCard
                    order={order}
                    today={today}
                    timezone={timezone}
                    variant="list"
                  />
                </li>
              ))}
            </ul>
          )}
          {bucket.count > bucket.orders.length ? (
            <p className="text-sm text-muted-foreground">
              Mostrando {bucket.orders.length} de {bucket.count}
            </p>
          ) : null}
        </section>
      ))}
    </div>
  );
}

function CounterOrderCard({
  order,
  today,
  timezone,
  variant,
}: {
  order: CounterOrder;
  today: string;
  timezone: string;
  variant: CounterViewMode;
}) {
  const overdue = isOverdueCounterOrder(order, today, timezone);
  const description = order.description?.trim();
  const workLine = description && description !== order.title ? description : null;

  return (
    <Link
      href={`/orders/${order.id}`}
      className={cn(
        "block rounded-[var(--radius)] border border-border/80 bg-card shadow-sm transition-colors",
        "hover:border-primary/40 hover:bg-primary/5",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        cardAccentClass(order, today, timezone),
        variant === "grid" ? "h-full min-h-0 px-3.5 py-3.5" : "min-h-14 px-4 py-4"
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="font-mono text-sm font-semibold tracking-wide">
          {order.reference}
        </p>
        <div className="flex flex-wrap justify-end gap-1.5">
          {overdue ? (
            <StatusBadge tone="danger">Retrasado</StatusBadge>
          ) : null}
          <StatusBadge tone={priorityTone(order.priority)}>
            {formatPriority(order.priority)}
          </StatusBadge>
          {order.status?.is_ready ? (
            <StatusBadge tone="brand">Listo</StatusBadge>
          ) : null}
        </div>
      </div>
      <p className="mt-1.5 text-[0.9375rem] font-semibold leading-snug text-foreground">
        {order.client_name || "Sin cliente"}
      </p>
      <p className="mt-1 line-clamp-2 text-sm font-medium leading-snug text-foreground">
        {order.title}
      </p>
      {workLine ? (
        <p className="mt-0.5 line-clamp-1 text-sm text-muted-foreground">
          {workLine}
        </p>
      ) : null}
      <p className="mt-1 text-sm text-muted-foreground">
        {order.service_name || "Sin servicio"}
        {order.store_name ? ` · ${order.store_name}` : ""}
      </p>
      <p className="mt-1 text-sm text-foreground/90">
        {order.assignee_name || "Sin responsable"}
      </p>
      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <StatusBadge status={order.status}>{order.status?.name}</StatusBadge>
        <span
          className={cn(
            overdue
              ? "font-medium text-[hsl(var(--gc-danger))]"
              : "text-muted-foreground"
          )}
        >
          {dueLabel(order.due_at, today, timezone)}
        </span>
      </div>
    </Link>
  );
}
