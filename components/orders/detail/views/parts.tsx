"use client";

import { useState, type ReactNode } from "react";

import { StatusBadge } from "@/components/gestcopy/status-badge";
import type { OrderDetailFacts } from "@/components/orders/detail/views/contract";
import { getOrderAttentionSignals } from "@/lib/orders/attention";
import { formatDate, formatPriority } from "@/lib/orders/format";
import type { OrderStatus } from "@/lib/orders/types";
import { cn } from "@/lib/utils";

// Shared building blocks of the Order Detail Views. Presentation only: no
// loads, no data state. Every block keeps its module mounted.

/**
 * One slot of a layout. Collapses when its module is null (feature off) so
 * the gap does not leave holes, and neutralises the module's own outer
 * margin, since layouts space modules with `gap`.
 */
export function Block({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0 empty:hidden [&>*]:!mb-0", className)}>
      {children}
    </div>
  );
}

/**
 * A fold. `<details>` keeps its content mounted when closed, so a folded
 * module keeps its state and never loads twice. `forceOpen` keeps it open
 * (e.g. while editing); a new `openSignal` opens it in the same render, so a
 * child that scrolls to itself right after (the post-it composer) is visible.
 */
export function Fold({
  title,
  hint,
  defaultOpen = false,
  forceOpen = false,
  openSignal = 0,
  children,
  className,
}: {
  title: string;
  hint?: string;
  defaultOpen?: boolean;
  forceOpen?: boolean;
  openSignal?: number;
  children: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [handledSignal, setHandledSignal] = useState(openSignal);
  if (openSignal !== handledSignal) {
    setHandledSignal(openSignal);
    if (openSignal > 0) setOpen(true);
  }

  return (
    <details
      className={cn("group min-w-0", className)}
      open={open || forceOpen}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      data-fold={title}
    >
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-[var(--radius)] border border-border/70 bg-card px-4 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-secondary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-open:mb-4 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">
          {title}
          {hint ? (
            <span className="ml-2 font-normal text-muted-foreground">{hint}</span>
          ) : null}
        </span>
        <span
          aria-hidden="true"
          className="shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
        >
          ▾
        </span>
      </summary>
      <div className="flex min-w-0 flex-col gap-5">{children}</div>
    </details>
  );
}

function isActiveStatus(status: OrderStatus) {
  return (status as { active?: boolean }).active !== false;
}

/**
 * The next status of the tenant's own catalog (ordered by sort_order), never
 * a cancelled one. Only a hint: changing status still goes through the
 * header's quick actions and its confirmations.
 */
export function nextStatusHint(facts: OrderDetailFacts): OrderStatus | null {
  const { order, statuses } = facts;
  if (!order.status || order.status.is_closed || order.status.is_cancelled) {
    return null;
  }
  const catalog = statuses.filter(isActiveStatus);
  const index = catalog.findIndex(
    (status) => status.id === order.status_id || status.code === order.status?.code
  );
  if (index < 0) return null;
  return (
    catalog.slice(index + 1).find((status) => !status.is_cancelled) ?? null
  );
}

/**
 * Production board: status, responsible, delivery, priority and what comes
 * next, read from the order already loaded. Used by views C and D.
 */
export function ProductionBoard({
  facts,
  className,
}: {
  facts: OrderDetailFacts;
  className?: string;
}) {
  const { order } = facts;
  const next = nextStatusHint(facts);
  const signals = getOrderAttentionSignals(order);
  const responsible = order.assigned_team_member?.name?.trim();

  return (
    <section
      aria-label="Producción del pedido"
      className={cn(
        "gc-card grid grid-cols-2 gap-x-4 gap-y-3 px-4 py-4 text-sm sm:grid-cols-4 sm:px-5",
        className
      )}
    >
      <div className="min-w-0">
        <p className="text-muted-foreground">Estado</p>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {facts.archived ? <StatusBadge tone="neutral">Archivado</StatusBadge> : null}
          <StatusBadge status={order.status ?? null} />
        </div>
      </div>
      <div className="min-w-0">
        <p className="text-muted-foreground">Responsable</p>
        <p
          className={cn(
            "mt-1 break-words font-semibold",
            responsible ? "text-foreground" : "text-[hsl(var(--gc-warning))]"
          )}
        >
          {responsible || "Sin responsable"}
        </p>
      </div>
      <div className="min-w-0">
        <p className="text-muted-foreground">Entrega</p>
        <p className="mt-1 font-semibold tabular-nums text-foreground">
          {formatDate(order.due_at)}
        </p>
      </div>
      <div className="min-w-0">
        <p className="text-muted-foreground">Prioridad</p>
        <p className="mt-1 font-semibold text-foreground">
          {formatPriority(order.priority)}
        </p>
      </div>
      {next || signals.length > 0 ? (
        <div className="col-span-2 flex flex-wrap items-center gap-2 border-t border-border/70 pt-3 sm:col-span-4">
          {next ? (
            <p className="text-muted-foreground">
              Siguiente estado:{" "}
              <span className="font-semibold text-foreground">{next.name}</span>
            </p>
          ) : null}
          {signals.map((signal) => (
            <StatusBadge key={signal.id} tone={signal.tone}>
              {signal.label}
            </StatusBadge>
          ))}
        </div>
      ) : null}
    </section>
  );
}
