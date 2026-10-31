// SUR4 E4 (contract §6, N9, N12, N17): the customer receipt («Resguardo»).
// Pure: closed select and model. Never notes, post-its, staff names, status,
// priority, file names or status, payment detail or external_folder_url.
import { orderLabels, RECEIPT_DESCRIPTION_TITLE } from "@/lib/orders/labels";
import { formatPrintTimestamp } from "@/lib/print/format";
import type { CustomerReceiptModel, PrintFact } from "@/lib/print/types";
import {
  amountFacts,
  printableService,
  type CollectionAmounts,
} from "@/lib/print/work-sheet-rules";
import { richTextToPlainText } from "@/lib/rich-text/html";

/** The closed list of order fields of the receipt (a code test guards it). */
export const CUSTOMER_RECEIPT_SELECT = `
  reference,
  title,
  description,
  received_at,
  due_at,
  client:clients(name, company_name, email, phone),
  service:services(name),
  store:stores(name)
`;

export type CustomerReceiptSource = {
  reference: string;
  title?: string | null;
  description?: string | null;
  received_at?: string | null;
  due_at?: string | null;
  client?: {
    name?: string | null;
    company_name?: string | null;
    email?: string | null;
    phone?: string | null;
  } | null;
  service?: { name?: string | null } | null;
  store?: { name?: string | null } | null;
};

export type CustomerReceiptInput = {
  /** order_custom_labels: only the names of the amounts change (N16). */
  customLabels: boolean;
  amounts: CollectionAmounts | null;
  businessName: string;
  brandColor: string;
  /** The footer the tenant configured for its documents (#144). */
  footer: string;
  timeZone: string;
  printedAt: Date;
};

function text(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed || null;
}

function facts(rows: Array<[string, string | null | undefined]>): PrintFact[] {
  return rows.flatMap(([label, value]) => {
    const clean = text(value);
    return clean ? [{ label, value: clean }] : [];
  });
}

/** Only letters, digits, «-» and «_»: never the client name or a path. */
export function receiptFilename(reference: string | null | undefined): string {
  const safe = (reference ?? "")
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return `Resguardo-${safe || "pedido"}.pdf`;
}

export function customerReceiptModel(
  order: CustomerReceiptSource,
  input: CustomerReceiptInput
): CustomerReceiptModel {
  const reference = text(order.reference) ?? "Sin referencia";
  const labels = orderLabels({ custom: input.customLabels });
  const serviceName = text(order.service?.name);
  const description = richTextToPlainText(order.description)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const storeName = text(order.store?.name);

  return {
    documentTitle: `Resguardo ${reference}`,
    filename: receiptFilename(reference),
    reference,
    title: text(order.title) ?? "Sin título",
    businessName: text(input.businessName) ?? "",
    brandColor: input.brandColor,
    footer: input.footer,
    printedAt: formatPrintTimestamp(input.printedAt.toISOString(), input.timeZone) ?? "",
    client: facts([
      ["Nombre", order.client?.name],
      ["Empresa", order.client?.company_name],
      ["Teléfono", order.client?.phone],
      ["Email", order.client?.email],
    ]),
    amounts: amountFacts(input.amounts, labels),
    dates: [
      {
        label: "Fecha de recepción",
        value: formatPrintTimestamp(order.received_at, input.timeZone) ?? "—",
      },
      {
        label: "Entrega prevista",
        value: formatPrintTimestamp(order.due_at, input.timeZone) ?? "—",
      },
    ],
    pickup: storeName ? { label: "Lugar de recogida", value: storeName } : null,
    descriptionTitle: RECEIPT_DESCRIPTION_TITLE,
    descriptionLines: [
      ...(serviceName && printableService(serviceName, order.description) ? [serviceName] : []),
      ...description,
    ],
  };
}
