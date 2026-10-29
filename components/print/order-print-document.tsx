import { Check } from "lucide-react";
import {
  PrintFacts,
  PrintFiles,
  PrintFrame,
  PrintRichText,
} from "@/components/print/print-frame";
import { WorkStageIcon } from "@/components/orders/work-stage-icon";
import { RichTextContent } from "@/components/rich-text/rich-text-content";
import { LEGACY_NOTES_NOTICE } from "@/lib/print/work-sheet-rules";
import type {
  PrintFact,
  WorkSheetFicha,
  WorkSheetModel,
  WorkSheetNote,
  WorkSheetStep,
} from "@/lib/print/types";

type WorkSheetProps = {
  model: WorkSheetModel;
  /** Route of the customer receipt PDF; the toolbar offers it when present. */
  receiptHref?: string;
  /** N23: the order has legacy notes, which are never printed. */
  legacyNotes?: boolean;
};

/**
 * SUR4 E2: the order work sheet (/orders/[id]/print). The profile was chosen
 * on the server (workSheetProfile); this component only lays out the blocks
 * the model carries. No block prints orders.notes: the model has no field
 * for them.
 */
export function WorkSheetDocument({ model, receiptHref, legacyNotes = false }: WorkSheetProps) {
  const notice = legacyNotes ? LEGACY_NOTES_NOTICE : null;
  if (model.profile === "ficha" && model.ficha) {
    return (
      <FichaWorkSheet
        model={model}
        ficha={model.ficha}
        receiptHref={receiptHref}
        notice={notice}
      />
    );
  }

  // Standard profile: today's blocks, fields and order, without «Notas
  // internas»; steps and printable post-its after them, only with data.
  return (
    <PrintFrame
      branding={model.branding}
      kind={model.kind}
      reference={model.reference}
      receiptHref={receiptHref}
      notice={notice}
    >
      <h1 className="print-title">{model.title}</h1>
      <PrintFacts title="Cliente" rows={model.client} />
      <PrintFacts title="Pedido" rows={model.order} />
      <PrintFacts title="Fechas" rows={model.dates} />
      <PrintRichText title={model.descriptionTitle} value={model.description} textStyles />
      <PrintFacts title="Producción" rows={model.production} />
      <PrintFacts title="Cobro y entrega" rows={model.payment} />
      <PrintFiles countLabel={model.fileCountLabel} files={model.files} />
      <WorkSheetSteps steps={model.steps} />
      <WorkSheetNotes notes={model.printableNotes} />
    </PrintFrame>
  );
}

function FactList({ rows, className }: { rows: PrintFact[]; className: string }) {
  if (rows.length === 0) return null;
  return (
    <dl className={className}>
      {rows.map((row) => (
        <div className="print-fact" key={row.label}>
          <dt>{row.label}</dt>
          <dd>{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

// Only digits and date punctuation from Intl reach the stylesheet text.
function pageFooterCss(ficha: WorkSheetFicha): string {
  const printedAt = ficha.printedAt.replace(/[^0-9/:,. ]/g, "");
  return `@page ws-ficha { @bottom-left { content: "Documento interno \\00B7  Impreso el ${printedAt}"; } }`;
}

// Ficha profile (N19, N20): the layout of sur4-0134.
function FichaWorkSheet({
  model,
  ficha,
  receiptHref,
  notice,
}: {
  model: WorkSheetModel;
  ficha: WorkSheetFicha;
  receiptHref?: string;
  notice: string | null;
}) {
  return (
    <PrintFrame
      branding={model.branding}
      kind={model.kind}
      reference={model.reference}
      referenceNote={ficha.store ? `Tienda: ${ficha.store}` : null}
      receiptHref={receiptHref}
      notice={notice}
      sheetClassName="ws-ficha"
    >
      <h1 className="print-title">{model.title}</h1>
      <section className="print-block ws-head">
        <div className="ws-head-client">
          <h2 className="print-section-title">Cliente</h2>
          <FactList rows={model.client} className="ws-facts" />
        </div>
        <div className="ws-head-side">
          <FactList rows={ficha.amounts} className="ws-facts ws-amounts" />
          <FactList rows={[ficha.dueAt]} className="ws-facts ws-due" />
          <dl className="ws-facts ws-proof">
            {ficha.proofFields.map((label) => (
              <div className="print-fact ws-blank" key={label}>
                <dt>{label}</dt>
                <dd aria-label="Para rellenar a mano" />
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section className="print-block print-rich ws-description">
        <h2 className="print-section-title">{model.descriptionTitle}</h2>
        {ficha.service ? <p className="ws-service">{ficha.service}</p> : null}
        <RichTextContent value={model.description} textStyles />
      </section>

      <section className="print-block ws-assignee">
        <FactList rows={[ficha.assignee]} className="ws-facts ws-inline" />
        <WorkSheetSteps steps={model.steps} />
      </section>

      <section className="print-block ws-bottom">
        <FactList rows={ficha.bottom} className="ws-facts ws-bottom-row" />
      </section>

      <WorkSheetNotes notes={model.printableNotes} />

      <footer className="ws-footer print-screen-only">
        {ficha.footer} · Impreso el {ficha.printedAt}
      </footer>
      <style>{pageFooterCss(ficha)}</style>
    </PrintFrame>
  );
}

function WorkSheetSteps({ steps }: { steps: WorkSheetStep[] }) {
  if (steps.length === 0) return null;
  return (
    <section className="print-block ws-steps">
      <h2 className="print-section-title">Secuencia de trabajo</h2>
      <ol className="ws-step-list">
        {steps.map((step) => (
          <li className="ws-step" key={`${step.position}-${step.stageName}`}>
            <span
              className="ws-check"
              role="img"
              aria-label={step.done ? "Hecho" : "Pendiente"}
            >
              {step.done ? <Check className="ws-check-mark" aria-hidden="true" /> : null}
            </span>
            <WorkStageIcon icon={step.stageIcon} className="ws-step-icon" />
            <span className="ws-step-name">{step.stageName}</span>
            <span className="ws-step-person">
              {step.personName}
              {step.executorName ? ` · lo hizo ${step.executorName}` : null}
            </span>
            {step.current ? <span className="ws-step-current">Le toca</span> : null}
          </li>
        ))}
      </ol>
    </section>
  );
}

function WorkSheetNotes({ notes }: { notes: WorkSheetNote[] }) {
  if (notes.length === 0) return null;
  return (
    <section className="print-block ws-notes">
      <h2 className="print-section-title">Post-its</h2>
      <ul className="ws-note-list">
        {notes.map((note, index) => (
          <li className="ws-note print-rich" key={index}>
            <RichTextContent value={note.body} textStyles />
          </li>
        ))}
      </ul>
    </section>
  );
}
