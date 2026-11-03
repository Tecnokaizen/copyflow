import Link from "next/link";
import { Check, Circle, CircleDashed, CircleDot, History } from "lucide-react";
import { SectionCard } from "@/components/gestcopy/section-card";
import { formatActivityDate } from "@/lib/orders/format";
import {
  TRACKING_STATE_LABELS,
  buildOrderTracking,
  type TrackingStep,
} from "@/lib/orders/visual-tracking";
import type { ActivityItem, Order, OrderStatus } from "@/lib/orders/types";
import { cn } from "@/lib/utils";

const ORDER_TRACKING_HELP_HREF =
  "/ayuda/pedidos/estados-y-prioridades#consultar-el-seguimiento";

// A visited step after the current one (the order went back, or was reopened)
// never gets a check mark: it was visited, not completed.
function stepIcon(step: TrackingStep) {
  if (step.state === "current") return CircleDot;
  if (step.state === "visited") return step.beyondCurrent ? History : Check;
  if (step.state === "unconfirmed") return CircleDashed;
  return Circle;
}

function markerClass(step: TrackingStep) {
  if (step.state === "current") return "border-primary bg-primary text-primary-foreground";
  if (step.state === "visited" && !step.beyondCurrent) return "border-primary/40 bg-secondary text-foreground";
  if (step.state === "visited") return "border-dashed border-muted-foreground/60 bg-card text-muted-foreground";
  return "border-border bg-card text-muted-foreground";
}

function StepDate({ step }: { step: TrackingStep }) {
  if (step.enteredAt) {
    return (
      <time dateTime={step.enteredAt}>
        {step.state === "current" ? "Desde el" : "Registrado el"} {formatActivityDate(step.enteredAt)}
      </time>
    );
  }
  return step.state === "current" ? <span>Sin fecha registrada</span> : null;
}

export function OrderTracking({ order, statuses, activity, loading, unavailable }: {
  order: Order;
  statuses: OrderStatus[];
  activity: ActivityItem[];
  loading: boolean;
  unavailable: boolean;
}) {
  // A failed refresh must not present stale history as a complete record.
  const steps = buildOrderTracking(order, unavailable || loading ? [] : statuses, unavailable || loading ? [] : activity);
  const status = loading ? "loading" : unavailable ? "unavailable" : "ready";
  const message = status === "loading"
    ? "Cargando seguimiento…"
    : status === "unavailable"
      ? "No se pudo cargar el seguimiento completo. Se muestra el estado actual."
      : "";
  return (
    <SectionCard
      title="Seguimiento del pedido"
      description="Consulta el estado y los pasos registrados."
      actions={
        <Link
          href={ORDER_TRACKING_HELP_HREF}
          aria-label="Ayuda sobre el seguimiento del pedido"
          className="shrink-0 self-start rounded-sm text-sm font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          Ayuda
        </Link>
      }
      className="mb-6"
      bodyClassName="px-5 py-4 sm:px-6"
    >
      {/* Always mounted so screen readers announce loading and errors. */}
      <p aria-live="polite" className={message ? "mb-3 text-sm text-muted-foreground" : "sr-only"}>
        {message}
      </p>
      <ol aria-label="Recorrido del pedido" data-tracking-status={status} className="max-w-3xl">
        {steps.map((step) => {
          const Icon = stepIcon(step);
          const current = step.state === "current";
          return (
            <li
              key={step.id}
              aria-current={current ? "step" : undefined}
              data-step-state={step.state}
              data-beyond-current={step.beyondCurrent ? "true" : "false"}
              className="group relative flex min-w-0 gap-3 pb-3 last:pb-0"
            >
              <div aria-hidden="true" className="relative flex w-7 shrink-0 justify-center pt-1">
                <span className="absolute bottom-0 top-8 w-px bg-border group-last:hidden" />
                <span className={cn("relative z-10 flex h-7 w-7 items-center justify-center rounded-full border", markerClass(step))}>
                  <Icon className="h-3.5 w-3.5" />
                </span>
              </div>
              <div
                className={cn(
                  "min-w-0 flex-1 rounded-md border px-3 py-1.5 lg:grid lg:grid-cols-[minmax(0,14rem)_9.5rem_minmax(0,1fr)] lg:items-baseline lg:gap-x-4",
                  current ? "border-primary/40 bg-secondary/40" : "border-transparent"
                )}
              >
                <span data-step-name className="block min-w-0 break-words font-medium [overflow-wrap:anywhere]">
                  {step.name}
                </span>
                <div className="mt-0.5 flex flex-col text-sm text-muted-foreground lg:contents">
                  <span data-step-label className={current ? "font-medium text-foreground" : undefined}>
                    {TRACKING_STATE_LABELS[step.state]}
                  </span>
                  <StepDate step={step} />
                </div>
                {step.inactive ? (
                  <p className="mt-0.5 text-xs text-muted-foreground lg:col-span-3">Estado desactivado</p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </SectionCard>
  );
}
