import { brandMarkUsesFill } from "@/lib/tenant/branding";
import { isRichTextEmpty } from "@/lib/rich-text/html";
import {
  formatCustomerNotificationStatus,
  formatPriority,
} from "@/lib/orders/format";
import { orderLabels } from "@/lib/orders/labels";
import type { OrderFeatures } from "@/lib/orders/order-features";
import {
  formatPrintTimestamp,
  printFileCountLabel,
  printFileNames,
} from "@/lib/print/format";
import {
  amountFacts,
  printableNotes,
  printableService,
  printableStore,
  WORK_SHEET_PROOF_FIELDS,
  workSheetSteps,
  type CollectionAmounts,
  type WorkSheetNoteRow,
  type WorkSheetStepRow,
} from "@/lib/print/work-sheet-rules";
import type {
  PrintBranding,
  PrintFact,
  WorkSheetFicha,
  WorkSheetModel,
  WorkSheetProfile,
} from "@/lib/print/types";

/**
 * What the work sheet reads from an order (WORK_SHEET_SELECT). There is no
 * field for orders.notes, clients.notes or external_folder_url: extra keys in
 * a row are never copied, every block is built field by field.
 */
export type WorkSheetSource = {
  reference: string;
  title?: string | null;
  description?: string | null;
  priority?: string | null;
  received_at?: string | null;
  due_at?: string | null;
  ready_at?: string | null;
  delivered_at?: string | null;
  customer_notification_status?: string | null;
  client?: {
    name?: string | null;
    company_name?: string | null;
    contact_name?: string | null;
    email?: string | null;
    phone?: string | null;
  } | null;
  service?: { name?: string | null } | null;
  store?: { name?: string | null } | null;
  entry_channel?: { name?: string | null } | null;
  order_context?: { name?: string | null } | null;
  status?: { name?: string | null } | null;
  assigned_team_member?: { name?: string | null } | null;
  file_status?: { name?: string | null } | null;
  quote_status?: { name?: string | null } | null;
  payment_status?: { name?: string | null } | null;
  delivery_method?: { name?: string | null } | null;
};

export type WorkSheetInput = {
  profile: WorkSheetProfile;
  features: OrderFeatures;
  branding: PrintBranding;
  timeZone: string;
  /** Standard profile only: every non-deleted file, as today. */
  files?: Array<string | null | undefined>;
  steps?: WorkSheetStepRow[] | null;
  notes?: WorkSheetNoteRow[] | null;
  /** Both profiles: the same collection snapshot as the customer receipt. */
  amounts?: CollectionAmounts | null;
  activeStoreCount?: number;
  printedAt?: Date | string;
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

function facts(rows: Array<PrintFact | null>): PrintFact[] {
  return rows.filter((row): row is PrintFact => row !== null);
}

export function printBranding(input: {
  displayName?: string | null;
  logoUrl?: string | null;
  brandColor?: string | null;
}): PrintBranding {
  const color = input.brandColor?.trim() || null;
  return {
    displayName: text(input.displayName) ?? "",
    logoUrl: input.logoUrl === "/api/tenant/logo" ? input.logoUrl : null,
    brandColor: color && brandMarkUsesFill(color) ? color : null,
  };
}

function clientFacts(order: WorkSheetSource): PrintFact[] {
  return facts([
    fact("Nombre", order.client?.name),
    fact("Empresa", order.client?.company_name),
    fact("Contacto", order.client?.contact_name),
    fact("Teléfono", order.client?.phone),
    fact("Email", order.client?.email),
  ]);
}

// The standard profile: the same blocks, fields and order as the print of
// today (orderPrintModel before E2), without «Notas internas».
function standardBlocks(order: WorkSheetSource, input: WorkSheetInput) {
  const readyAt = formatPrintTimestamp(order.ready_at, input.timeZone);
  const deliveredAt = formatPrintTimestamp(order.delivered_at, input.timeZone);
  const files = printFileNames(input.files ?? []);

  return {
    order: facts([
      fact("Servicio", order.service?.name),
      fact("Tienda", order.store?.name),
      fact("Canal", order.entry_channel?.name),
      fact("Contexto", order.order_context?.name),
      fact("Estado", order.status?.name),
      fact("Prioridad", formatPriority(order.priority ?? "")),
      fact(
        "Responsable",
        order.assigned_team_member?.name ?? "Sin responsable"
      ),
    ]),
    dates: facts([
      fact(
        "Recepción",
        formatPrintTimestamp(order.received_at, input.timeZone) ?? "—"
      ),
      fact(
        "Entrega prevista",
        formatPrintTimestamp(order.due_at, input.timeZone) ?? "—"
      ),
      readyAt ? fact("Terminado", readyAt) : null,
      deliveredAt ? fact("Entregado", deliveredAt) : null,
    ]),
    production: facts([
      fact("Archivos", order.file_status?.name),
      fact("Presupuesto del pedido", order.quote_status?.name),
    ]),
    payment: facts([
      fact("Pago", order.payment_status?.name),
      fact("Método de entrega", order.delivery_method?.name),
      fact(
        "Cliente avisado",
        formatCustomerNotificationStatus(order.customer_notification_status ?? "")
      ),
    ]),
    files,
    fileCountLabel: printFileCountLabel(files.length),
  };
}

// The ficha profile (N19, N20): the layout of sur4-0134. No order status,
// channel, context, ready/delivered dates or file list.
function fichaBlocks(order: WorkSheetSource, input: WorkSheetInput): WorkSheetFicha {
  const storeName = text(order.store?.name);
  const serviceName = text(order.service?.name);

  return {
    store: storeName && printableStore(storeName, input.activeStoreCount ?? 0) ? storeName : null,
    dueAt: {
      label: "Fecha de entrega",
      value: formatPrintTimestamp(order.due_at, input.timeZone) ?? "—",
    },
    proofFields: [...WORK_SHEET_PROOF_FIELDS],
    service: serviceName && printableService(serviceName, order.description) ? serviceName : null,
    assignee: {
      label: "Responsable",
      value: text(order.assigned_team_member?.name) ?? "Sin responsable",
    },
    bottom: [
      { label: "Prioridad", value: formatPriority(order.priority ?? "") },
      {
        label: "Fecha de recepción",
        value: formatPrintTimestamp(order.received_at, input.timeZone) ?? "—",
      },
      { label: "Archivos", value: text(order.file_status?.name) ?? "—" },
      { label: "Presupuesto", value: text(order.quote_status?.name) ?? "—" },
    ],
    footer: "Documento interno",
    printedAt: formatPrintTimestamp(
      typeof input.printedAt === "string" ? input.printedAt : (input.printedAt ?? new Date()).toISOString(),
      input.timeZone
    ) ?? "—",
  };
}

/**
 * SUR4 E2: the work sheet of an order. Pure: the profile comes from the
 * caller (workSheetProfile on server-side features), and steps and post-its
 * are printed only with their feature and when there is data (contract §6).
 */
export function workSheetModel(order: WorkSheetSource, input: WorkSheetInput): WorkSheetModel {
  const reference = text(order.reference) ?? "Sin referencia";
  const clientName = text(order.client?.name) ?? "Sin cliente";
  const title = text(order.title) ?? "Sin título";
  const labels = orderLabels({ custom: input.features.customLabels });
  const standard = input.profile === "standard" ? standardBlocks(order, input) : null;

  return {
    profile: input.profile,
    documentTitle: `Pedido ${reference} — ${clientName}`,
    kind: input.profile === "ficha" ? "Hoja de trabajo" : "Pedido",
    reference,
    title,
    branding: input.branding,
    amounts: amountFacts(input.amounts ?? null, labels),
    client: clientFacts(order),
    order: standard?.order ?? [],
    dates: standard?.dates ?? [],
    description: isRichTextEmpty(order.description) ? null : order.description ?? null,
    descriptionTitle: labels.description,
    production: standard?.production ?? [],
    payment: standard?.payment ?? [],
    files: standard?.files ?? [],
    fileCountLabel: standard?.fileCountLabel ?? "",
    steps: input.features.workSequence ? workSheetSteps(input.steps) : [],
    printableNotes: input.features.stickyNotes ? printableNotes(input.notes) : [],
    ficha: input.profile === "ficha" ? fichaBlocks(order, input) : null,
  };
}
