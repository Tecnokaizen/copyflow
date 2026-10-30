import type { OrderDetailLayoutProps } from "@/components/orders/detail/views/contract";
import { Block, ProductionBoard } from "@/components/orders/detail/views/parts";

// View D · Híbrida (A + C). The compact operational page with production up
// front: the production board, then the work sequence and the post-its side
// by side, then Trabajo and Archivos with payments and summary beside them.
//
// Without sequence and post-its (features off) the board alone leads.
// Mobile order: header, tablero, secuencia, post-its, Trabajo, Cobro y entrega,
// Resumen, Archivos, notas, actividad.
export function HybridOrderLayout({ modules, facts }: OrderDetailLayoutProps) {
  const highlights = [modules.sequence, modules.stickyNotes].filter(Boolean).length;

  return (
    <>
      {modules.notices}
      {modules.headerCompact}
      <Block className="mb-4">{modules.pinnedNotes}</Block>
      <Block className="mb-4">{modules.tracking}</Block>

      <ProductionBoard facts={facts} className="mb-5" />

      {highlights > 0 ? (
        <div
          className={
            highlights === 2
              ? "mb-6 grid gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] xl:items-start"
              : "mb-6 grid gap-5"
          }
        >
          <Block>{modules.sequence}</Block>
          <Block>{modules.stickyNotes}</Block>
        </div>
      ) : null}

      <div className="flex flex-col gap-5 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(17rem,21rem)] lg:items-start lg:gap-6">
        <div className="contents lg:flex lg:min-w-0 lg:flex-col lg:gap-5">
          <Block className="order-1">{modules.production}</Block>
          <Block className="order-4">{modules.files}</Block>
          <Block className="order-5">{modules.legacyNotes}</Block>
          {/* Activity folds itself («Actividad · N»). */}
          <Block className="order-6">{modules.activity}</Block>
        </div>

        <aside
          aria-label="Cobro y resumen"
          className="contents lg:flex lg:min-w-0 lg:flex-col lg:gap-5"
        >
          <Block className="order-2">{modules.sourceQuote}</Block>
          <Block className="order-2">{modules.fulfillment}</Block>
          <Block className="order-3">{modules.summary}</Block>
        </aside>
      </div>
    </>
  );
}
