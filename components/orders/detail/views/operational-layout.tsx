import type { OrderDetailLayoutProps } from "@/components/orders/detail/views/contract";
import { Block, Fold } from "@/components/orders/detail/views/parts";

// View A · Operativa. Compact header; the work (Trabajo, Archivos) in a wide
// main column; payments and summary always beside it; sequence, post-its,
// notes and activity in folds below the work so the page stays short.
//
// Mobile order: header, Trabajo, Cobro y entrega, Resumen, Archivos,
// secuencia, post-its y notas, actividad.
export function OperationalOrderLayout({ modules, facts }: OrderDetailLayoutProps) {
  const hasNotes = Boolean(modules.stickyNotes) || Boolean(modules.legacyNotes);

  return (
    <>
      {modules.notices}
      {modules.headerCompact}
      <Block className="mb-4">{modules.pinnedNotes}</Block>
      <Block className="mb-4">{modules.tracking}</Block>

      <div className="flex flex-col gap-5 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(17rem,21rem)] lg:items-start lg:gap-6">
        <div className="contents lg:flex lg:min-w-0 lg:flex-col lg:gap-5">
          <Block className="order-1">{modules.production}</Block>
          <Block className="order-4">{modules.files}</Block>
          {/* The sequence brings its own title and counter. */}
          <Block className="order-5">{modules.sequence}</Block>
          {hasNotes ? (
            <Fold
              className="order-6"
              title={modules.stickyNotes ? "Post-its y notas" : "Notas internas"}
              defaultOpen={Boolean(modules.stickyNotes)}
              forceOpen={facts.editing}
              openSignal={facts.noteComposeRequest}
            >
              <Block>{modules.stickyNotes}</Block>
              <Block>{modules.legacyNotes}</Block>
            </Fold>
          ) : null}
          {/* Activity folds itself («Actividad · N»). */}
          <Block className="order-7">{modules.activity}</Block>
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
