"use client";

import Link from "next/link";
import { EmptyState } from "@/components/gestcopy/empty-state";
import { StatusBadge } from "@/components/gestcopy/status-badge";
import { formatPriority } from "@/lib/orders/format";
import type { CounterBucket, CounterOrder } from "@/lib/orders/counter";
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

export function CounterBoard({
  buckets,
  today,
  timezone,
}: {
  buckets: CounterBucket[];
  today: string;
  timezone: string;
}) {
  const total = buckets.reduce((sum, bucket) => sum + bucket.count, 0);

  if (total === 0) {
    return (
      <div className="overflow-hidden rounded-lg border bg-card">
        <EmptyState title="No hay pedidos en el mostrador ahora mismo." />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {buckets.map((bucket) => (
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
          ) : (
            <ul className="space-y-2.5">
              {bucket.orders.map((order) => (
                <li key={`${bucket.id}-${order.id}`}>
                  <CounterOrderCard
                    order={order}
                    today={today}
                    timezone={timezone}
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
}: {
  order: CounterOrder;
  today: string;
  timezone: string;
}) {
  return (
    <Link
      href={`/orders/${order.id}`}
      className={cn(
        "block min-h-14 rounded-[var(--radius)] border border-border/80 bg-card px-4 py-4 shadow-sm transition-colors",
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
          {order.status?.is_ready ? (
            <StatusBadge tone="brand">Listo</StatusBadge>
          ) : null}
        </div>
      </div>
      <p className="mt-1.5 text-base font-medium leading-snug">{order.title}</p>
      <p className="mt-1 text-[0.9375rem] text-muted-foreground">
        {order.client_name || "Sin cliente"}
        {order.service_name ? ` · ${order.service_name}` : ""}
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        {order.store_name || "Sin tienda"}
        {order.assignee_name ? ` · ${order.assignee_name}` : ""}
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
