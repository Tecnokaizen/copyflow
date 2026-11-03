import type { OrderDetailLayoutProps } from "@/components/orders/detail/views/contract";
import { Block, ProductionBoard, WorkGroup } from "@/components/orders/detail/views/parts";

// View D · Híbrida: compact header and production board first, with the
// sequence/tracking and notes side by side on desktop. Resumen + Trabajo +
// Archivos now form one continuous work area; payments remain in the sidebar.
// Mobile order: board, sequence/notes, grouped work and payment.
export function HybridOrderLayout({ modules, facts }: OrderDetailLayoutProps) {
  return (
    <>
      {modules.notices}
      {modules.headerCompact}
      <ProductionBoard facts={facts} className="mb-5" />

      <div className="mb-6 grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] xl:items-start">
        <section aria-label="Secuencia y seguimiento" className="flex min-w-0 flex-col gap-4">
          <Block>{modules.sequence}</Block>
          <Block>{modules.tracking}</Block>
          <Block>{modules.activity}</Block>
        </section>
        <section aria-label="Post-its y notas" className="flex min-w-0 flex-col gap-4">
          <Block>{modules.pinnedNotes}</Block>
          <Block>{modules.stickyNotes}</Block>
          <Block>{modules.legacyNotes}</Block>
        </section>
      </div>

      <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(17rem,21rem)] lg:items-start lg:gap-6">
        <WorkGroup
          sourceQuote={modules.sourceQuote}
          summary={modules.summary}
          production={modules.production}
          files={modules.files}
        />
        <aside aria-label="Cobro y entrega" className="min-w-0">
          <Block>{modules.fulfillment}</Block>
        </aside>
      </div>
    </>
  );
}
