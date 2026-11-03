import type { OrderDetailLayoutProps } from "@/components/orders/detail/views/contract";
import { Block, Fold, WorkGroup } from "@/components/orders/detail/views/parts";

// View A · Operativa. Compact header and a wide, continuous work area:
// Resumen + Trabajo + Archivos. Cobro y entrega stays beside it on desktop.
// Sequence, visual tracking, activity and notes remain distinct below.
// On mobile: grouped work, payments, sequence/tracking, notes and activity.
export function OperationalOrderLayout({ modules, facts }: OrderDetailLayoutProps) {
  const hasNotes = Boolean(modules.pinnedNotes) || Boolean(modules.stickyNotes) || Boolean(modules.legacyNotes);

  return (
    <>
      {modules.notices}
      {modules.headerCompact}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(17rem,21rem)] lg:items-start lg:gap-6">
        <div className="min-w-0 lg:col-start-1 lg:row-start-1">
          <WorkGroup
            sourceQuote={modules.sourceQuote}
            summary={modules.summary}
            production={modules.production}
            files={modules.files}
          />
        </div>

        <aside aria-label="Cobro y entrega" className="min-w-0 lg:col-start-2 lg:row-start-1">
          <Block>{modules.fulfillment}</Block>
        </aside>

        <div className="flex min-w-0 flex-col gap-5 lg:col-start-1 lg:row-start-2">
          <section aria-label="Secuencia y seguimiento" className="flex min-w-0 flex-col gap-4">
            <Block>{modules.sequence}</Block>
            <Block>{modules.tracking}</Block>
            <Block>{modules.activity}</Block>
          </section>

          {hasNotes ? (
            <Fold
              title={modules.stickyNotes || modules.pinnedNotes ? "Post-its y notas" : "Notas internas"}
              defaultOpen={Boolean(modules.stickyNotes)}
              forceOpen={facts.editing}
              openSignal={facts.noteComposeRequest}
            >
              <Block>{modules.pinnedNotes}</Block>
              <Block>{modules.stickyNotes}</Block>
              <Block>{modules.legacyNotes}</Block>
            </Fold>
          ) : null}
        </div>
      </div>
    </>
  );
}
