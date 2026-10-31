import type { OrderDetailLayoutProps } from "@/components/orders/detail/views/contract";
import { Block, Fold, ProductionBoard } from "@/components/orders/detail/views/parts";

// View C · Producción. For the workshop: what to do now comes first.
// Compact header, production board (status, responsible, delivery, priority,
// next status), then the work sequence and the post-its, then Trabajo and
// Archivos side by side. Summary, payments, notes, quote and activity go in
// «Administración», folded but mounted, and open while editing the draft.
//
// Mobile order: header, tablero, secuencia, post-its, Trabajo, Archivos,
// Administración.
export function ProductionOrderLayout({ modules, facts }: OrderDetailLayoutProps) {
  const highlights = [modules.sequence, modules.stickyNotes].filter(Boolean).length;

  return (
    <>
      {modules.notices}
      {modules.headerCompact}
      <Block className="mb-4">{modules.pinnedNotes}</Block>

      <ProductionBoard facts={facts} className="mb-5 sm:py-5" />
      <Block className="mb-5">{modules.tracking}</Block>

      {highlights > 0 ? (
        <div
          className={
            highlights === 2
              ? "mb-6 grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] lg:items-start"
              : "mb-6 grid gap-5"
          }
        >
          <Block>{modules.sequence}</Block>
          <Block>{modules.stickyNotes}</Block>
        </div>
      ) : null}

      <div className="mb-6 grid gap-5 lg:grid-cols-2 lg:items-start">
        <Block>{modules.production}</Block>
        <Block>{modules.files}</Block>
      </div>

      <Fold
        title="Administración"
        hint="Resumen, cobro y entrega, notas y actividad"
        forceOpen={facts.editing}
      >
        <Block>{modules.sourceQuote}</Block>
        <div className="grid gap-5 lg:grid-cols-2 lg:items-start">
          <div className="flex min-w-0 flex-col gap-5">
            <Block>{modules.summary}</Block>
            <Block>{modules.legacyNotes}</Block>
          </div>
          <div className="flex min-w-0 flex-col gap-5">
            <Block>{modules.fulfillment}</Block>
            <Block>{modules.activity}</Block>
          </div>
        </div>
      </Fold>
    </>
  );
}
