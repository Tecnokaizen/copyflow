import Link from "next/link";

import {
  ORDER_DETAIL_VIEWS,
  type OrderDetailViewCode,
} from "@/lib/orders/detail-views";

function viewName(code: OrderDetailViewCode) {
  const info = ORDER_DETAIL_VIEWS[code];
  return info.letter ? `${info.letter} · ${info.name}` : info.name;
}

// Order Detail Views V1: shown only to owner/admin while previewing a view
// with `?vista=`. Nothing is saved; the rest of the team keeps the applied one.
export function OrderViewPreviewBanner({
  orderId,
  view,
  appliedView,
}: {
  orderId: string;
  view: OrderDetailViewCode;
  appliedView: OrderDetailViewCode;
}) {
  return (
    <div
      role="status"
      className="mb-4 flex flex-col gap-2 rounded-[var(--radius)] border border-primary/40 bg-primary/5 px-4 py-3 text-sm text-foreground sm:flex-row sm:items-center sm:justify-between"
    >
      <p>
        <span className="font-semibold">Vista previa: {viewName(view)}.</span>{" "}
        No se ha guardado nada. Tu equipo sigue viendo «{viewName(appliedView)}».
      </p>
      <div className="flex flex-wrap gap-2">
        <Link href="/settings/order-detail-view" className="gc-action min-h-11">
          Volver a Configuración
        </Link>
        <Link href={`/orders/${orderId}`} className="gc-action min-h-11">
          Salir de la vista previa
        </Link>
      </div>
    </div>
  );
}
