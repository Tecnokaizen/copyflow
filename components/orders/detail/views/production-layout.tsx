import type { OrderDetailLayoutProps } from "@/components/orders/detail/views/contract";
import { Block, Fold, ProductionBoard, WorkGroup } from "@/components/orders/detail/views/parts";
import { WorkSequencePresentationProvider } from "@/components/orders/work-sequence";

// On phones the sequence shows pending steps first (done ones fold away).
const PENDING_FIRST = { pendingFirstOnMobile: true };

// View C · Producción: workshop-first. Sequence and production board stay
// prominent. Resumen, Trabajo and Archivos are a single work area folded as
// «Gestión del pedido»; post-its and Cobro y entrega remain separate folds.
// All modules stay mounted in folds.
export function ProductionOrderLayout({ modules, facts }: OrderDetailLayoutProps) {
  const hasNotes = Boolean(modules.pinnedNotes) || Boolean(modules.stickyNotes) || Boolean(modules.legacyNotes);

  return (
    <>
      {modules.notices}
      {modules.headerProduction}

      <section aria-label="Secuencia y seguimiento" className="mb-5 flex min-w-0 flex-col gap-4">
        <WorkSequencePresentationProvider value={PENDING_FIRST}>
          <Block>{modules.sequence}</Block>
        </WorkSequencePresentationProvider>
        <Block>{modules.tracking}</Block>
        <Block>{modules.activity}</Block>
      </section>

      <ProductionBoard facts={facts} className="mb-5 sm:py-5" />

      <WorkGroup
        sourceQuote={modules.sourceQuote}
        summary={modules.summary}
        production={modules.production}
        files={modules.files}
        fold={{ forceOpen: facts.editing, className: "mb-5" }}
      />

      {hasNotes ? (
        <Fold
          title={modules.stickyNotes || modules.pinnedNotes ? "Post-its y notas" : "Notas internas"}
          className="mb-5"
          defaultOpen={Boolean(modules.stickyNotes)}
          forceOpen={facts.editing}
          openSignal={facts.noteComposeRequest}
        >
          <Block>{modules.pinnedNotes}</Block>
          <Block>{modules.stickyNotes}</Block>
          <Block>{modules.legacyNotes}</Block>
        </Fold>
      ) : null}

      <Fold
        title="Administración"
        hint="Cobro y entrega"
        forceOpen={facts.editing}
      >
        <Block>{modules.fulfillment}</Block>
      </Fold>
    </>
  );
}
