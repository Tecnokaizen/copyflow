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
    // One line on phones: the preview must not push the page it previews.
    <div
      role="status"
      className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[var(--radius)] border border-primary/40 bg-primary/5 px-3 py-1.5 text-sm text-foreground sm:px-4 sm:py-2"
    >
      <p className="min-w-0 flex-1">
        <span className="font-semibold">Vista previa: {viewName(view)}</span>
        <span className="hidden sm:inline">
          . No se ha guardado nada. Tu equipo sigue viendo «{viewName(appliedView)}».
        </span>
      </p>
      <Link
        href="/settings/order-detail-view"
        className="inline-flex min-h-9 items-center font-medium text-primary underline-offset-4 hover:underline"
        title="Volver a Configuración"
      >
        Configuración
      </Link>
      <Link
        href={`/orders/${orderId}`}
        className="inline-flex min-h-9 items-center font-medium text-primary underline-offset-4 hover:underline"
        title="Salir de la vista previa"
      >
        Salir
      </Link>
    </div>
  );
}
