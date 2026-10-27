import { Check, Circle, CircleDot } from "lucide-react";
import { SectionCard } from "@/components/gestcopy/section-card";
import { formatActivityDate } from "@/lib/orders/format";
import { buildOrderTracking } from "@/lib/orders/visual-tracking";
import type { ActivityItem, Order, OrderStatus } from "@/lib/orders/types";

const labels = {
  completed: "Completado · paso registrado",
  current: "Estado actual",
  pending: "Pendiente",
  unconfirmed: "Sin paso registrado",
};

export function OrderTracking({ order, statuses, activity, loading, unavailable }: {
  order: Order;
  statuses: OrderStatus[];
  activity: ActivityItem[];
  loading: boolean;
  unavailable: boolean;
}) {
  // A failed refresh must not present stale history as a complete record.
  const steps = buildOrderTracking(order, unavailable || loading ? [] : statuses, unavailable || loading ? [] : activity);
  return (
    <SectionCard
      title="Seguimiento del pedido"
      description="Recorrido según los estados configurados. Solo se completan pasos con evidencia en el historial; pueden repetirse o saltarse."
      className="mb-6"
      bodyClassName="px-5 py-5 sm:px-6"
    >
      <div aria-live="polite" className="mb-4 text-sm text-muted-foreground">
        {loading ? "Cargando recorrido… Se muestra el estado actual guardado." : unavailable
          ? "No se pudo cargar el recorrido completo. Se muestra el estado actual guardado."
          : "Las fechas corresponden a entradas registradas en cada estado. Sin registro no se estima una fecha."}
      </div>
      {order.status?.is_cancelled ? (
        <p className="mb-4 text-sm font-medium">Pedido cancelado. Los pasos sin registro no se consideran completados.</p>
      ) : null}
      {order.archived_at ? <p className="mb-4 text-sm text-muted-foreground">Pedido archivado · seguimiento en consulta.</p> : null}
      <ol aria-label="Recorrido del pedido" className="space-y-0">
        {steps.map((step) => {
          const Icon = step.state === "completed" ? Check : step.state === "current" ? CircleDot : Circle;
          return (
            <li key={step.id} aria-current={step.state === "current" ? "step" : undefined}
              className="group relative flex min-w-0 gap-3 pb-5 last:pb-0">
              <div aria-hidden="true" className="relative flex w-8 shrink-0 justify-center">
                <span className="absolute bottom-0 top-8 w-px bg-border group-last:hidden" />
                <span className={`relative z-10 flex h-8 w-8 items-center justify-center rounded-full border ${step.state === "current"
                  ? "border-primary bg-primary text-primary-foreground" : step.state === "completed"
                    ? "border-primary/40 bg-secondary text-foreground" : "border-border bg-card text-muted-foreground"}`}>
                  <Icon className="h-4 w-4" />
                </span>
              </div>
              <div className={`min-w-0 flex-1 rounded-lg px-3 py-2 ${step.state === "current" ? "border border-primary/40 bg-secondary/40" : "border border-transparent"}`}>
                <div className="flex flex-col gap-1 sm:flex-row sm:flex-wrap sm:items-baseline sm:justify-between sm:gap-x-4">
                  <span className="min-w-0 break-words font-medium [overflow-wrap:anywhere]">{step.name}</span>
                  <span className="text-sm text-muted-foreground">{labels[step.state]}</span>
                </div>
                {step.enteredAt ? <time dateTime={step.enteredAt} className="mt-1 block text-sm text-muted-foreground">Última entrada registrada: {formatActivityDate(step.enteredAt)}</time>
                  : step.state === "current" || step.state === "completed" ? <p className="mt-1 text-sm text-muted-foreground">Fecha de entrada no registrada</p> : null}
                {step.inactive ? <p className="mt-1 text-xs text-muted-foreground">Estado inactivo en la configuración</p> : null}
              </div>
            </li>
          );
        })}
      </ol>
    </SectionCard>
  );
}
