import {
  PrintFacts,
  PrintFiles,
  PrintFrame,
  PrintRichText,
} from "@/components/print/print-frame";
import type { OrderPrintModel } from "@/lib/print/types";

export function OrderPrintDocument({ model }: { model: OrderPrintModel }) {
  return (
    <PrintFrame
      branding={model.branding}
      kind={model.kind}
      reference={model.reference}
    >
      <h1 className="print-title">{model.title}</h1>
      <PrintFacts title="Cliente" rows={model.client} />
      <PrintFacts title="Pedido" rows={model.order} />
      <PrintFacts title="Fechas" rows={model.dates} />
      <PrintRichText title="Instrucciones" value={model.description} />
      <PrintFacts title="Producción" rows={model.production} />
      <PrintFacts title="Cobro y entrega" rows={model.payment} />
      <PrintRichText title="Notas internas" value={model.notes} />
      <PrintFiles countLabel={model.fileCountLabel} files={model.files} />
    </PrintFrame>
  );
}
