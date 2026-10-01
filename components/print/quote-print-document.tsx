import {
  PrintFacts,
  PrintFiles,
  PrintFrame,
  PrintRichText,
} from "@/components/print/print-frame";
import type { QuotePrintModel } from "@/lib/print/types";

export function QuotePrintDocument({ model }: { model: QuotePrintModel }) {
  return (
    <PrintFrame
      branding={model.branding}
      kind={model.kind}
      reference={model.reference}
    >
      <PrintFacts title="Datos" rows={model.details} />
      <PrintFacts title="Cliente" rows={model.client} />
      {model.service ? (
        <section className="print-block">
          <h2 className="print-section-title">Servicio</h2>
          <p className="print-muted">{model.service}</p>
        </section>
      ) : null}
      <h1 className="print-title">{model.title}</h1>
      <PrintRichText title="Descripción" value={model.description} />
      <PrintFiles countLabel={model.fileCountLabel} files={model.files} />
    </PrintFrame>
  );
}
