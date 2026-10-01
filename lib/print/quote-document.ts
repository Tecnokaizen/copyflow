import { isRichTextEmpty } from "@/lib/rich-text/html";
import {
  formatPrintCivilDate,
  formatPrintTimestamp,
  printFileCountLabel,
  printFileNames,
} from "@/lib/print/format";
import type { PrintBranding, PrintFact, QuotePrintModel } from "@/lib/print/types";

export type QuotePrintClient = {
  name?: string | null;
  company_name?: string | null;
  contact_name?: string | null;
  tax_id?: string | null;
  email?: string | null;
  phone?: string | null;
};

export type QuotePrintSource = {
  reference: string;
  title?: string | null;
  description?: string | null;
  notes?: string | null;
  valid_until?: string | null;
  created_at?: string | null;
  statusName?: string | null;
  serviceName?: string | null;
  assigneeName?: string | null;
  convertedOrderReference?: string | null;
  client?: QuotePrintClient | null;
};

function text(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed || null;
}

function fact(label: string, value: string | null | undefined): PrintFact | null {
  const trimmed = text(value);
  if (!trimmed) return null;
  return { label, value: trimmed };
}

export function quotePrintModel(
  quote: QuotePrintSource,
  input: {
    files: Array<string | null | undefined>;
    branding: PrintBranding;
    timeZone: string;
  }
): QuotePrintModel {
  const reference = text(quote.reference) ?? "Sin referencia";
  const clientName = text(quote.client?.name) ?? "Sin cliente";
  const validUntil = formatPrintCivilDate(quote.valid_until);
  const files = printFileNames(input.files);

  return {
    documentTitle: `Presupuesto ${reference} — ${clientName}`,
    kind: "Presupuesto",
    reference,
    title: text(quote.title) ?? "Presupuesto",
    branding: input.branding,
    details: [
      fact(
        "Fecha",
        formatPrintTimestamp(quote.created_at, input.timeZone) ?? "—"
      ),
      fact("Estado", quote.statusName),
      validUntil ? fact("Válido hasta", validUntil) : null,
    ].filter((row): row is PrintFact => row !== null),
    client: [
      fact("Nombre", quote.client?.name),
      fact("Empresa", quote.client?.company_name),
      fact("Contacto", quote.client?.contact_name),
      fact("NIF", quote.client?.tax_id),
      fact("Email", quote.client?.email),
      fact("Teléfono", quote.client?.phone),
    ].filter((row): row is PrintFact => row !== null),
    service: text(quote.serviceName),
    description: isRichTextEmpty(quote.description) ? null : quote.description ?? null,
    files,
    fileCountLabel: printFileCountLabel(files.length),
  };
}
