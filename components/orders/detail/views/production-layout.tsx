import type { OrderDetailLayoutProps } from "@/components/orders/detail/views/contract";
import { Block, Fold, ProductionBoard } from "@/components/orders/detail/views/parts";
import { WorkSequencePresentationProvider } from "@/components/orders/work-sequence";

// On phones the sequence shows pending steps first (done ones fold away).
const PENDING_FIRST = { pendingFirstOnMobile: true };

// View C · Producción. For the workshop: what is pending and «Le toca» come
// first. Production header (no amounts: they stay in «Cobro y entrega»), the
// work sequence right below it, then the production board (status,
// responsible, delivery, priority, next status), pinned and regular post-its,
// and Trabajo and Archivos side by side. Summary, payments, notes, quote and
// activity go in «Administración», folded but mounted, and open while editing.
//
// Without the sequence (feature off) the board leads.
// Mobile order: header with actions, secuencia, tablero, fijados, post-its,
// Trabajo, Archivos, seguimiento, Administración.
export function ProductionOrderLayout({ modules, facts }: OrderDetailLayoutProps) {
  return (
    <>
      {modules.notices}
      {modules.headerProduction}
      <WorkSequencePresentationProvider value={PENDING_FIRST}>
        <Block className="mb-4">{modules.sequence}</Block>
      </WorkSequencePresentationProvider>

      <ProductionBoard facts={facts} className="mb-4 sm:py-5" />
      <Block className="mb-4">{modules.pinnedNotes}</Block>
      <Block className="mb-6">{modules.stickyNotes}</Block>

      <div className="mb-6 grid gap-5 lg:grid-cols-2 lg:items-start">
        <Block>{modules.production}</Block>
        <Block>{modules.files}</Block>
      </div>

      {/* Seguimiento (#153) after the floor work, before Administración. */}
      <Block className="mb-6">{modules.tracking}</Block>

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
