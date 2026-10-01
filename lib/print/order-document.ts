import { brandMarkUsesFill } from "@/lib/tenant/branding";
import { isRichTextEmpty } from "@/lib/rich-text/html";
import {
  formatCustomerNotificationStatus,
  formatPriority,
} from "@/lib/orders/format";
import {
  formatPrintTimestamp,
  printFileCountLabel,
  printFileNames,
} from "@/lib/print/format";
import type { OrderPrintModel, PrintBranding, PrintFact } from "@/lib/print/types";

export type OrderPrintSource = {
  reference: string;
  title?: string | null;
  description?: string | null;
  notes?: string | null;
  priority?: string | null;
  received_at?: string | null;
  due_at?: string | null;
  ready_at?: string | null;
  delivered_at?: string | null;
  customer_notification_status?: string | null;
  external_folder_url?: string | null;
  client?: {
    name?: string | null;
    company_name?: string | null;
    contact_name?: string | null;
    tax_id?: string | null;
    email?: string | null;
    phone?: string | null;
    notes?: string | null;
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

export function orderPrintModel(
  order: OrderPrintSource,
  input: {
    files: Array<string | null | undefined>;
    branding: PrintBranding;
    timeZone: string;
  }
): OrderPrintModel {
  const reference = text(order.reference) ?? "Sin referencia";
  const clientName = text(order.client?.name) ?? "Sin cliente";
  const title = text(order.title) ?? "Sin título";
  const readyAt = formatPrintTimestamp(order.ready_at, input.timeZone);
  const deliveredAt = formatPrintTimestamp(order.delivered_at, input.timeZone);

  return {
    documentTitle: `Pedido ${reference} — ${clientName}`,
    kind: "Pedido",
    reference,
    title,
    branding: input.branding,
    client: facts([
      fact("Nombre", order.client?.name),
      fact("Empresa", order.client?.company_name),
      fact("Contacto", order.client?.contact_name),
      fact("Teléfono", order.client?.phone),
      fact("Email", order.client?.email),
    ]),
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
    description: isRichTextEmpty(order.description) ? null : order.description ?? null,
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
    notes: isRichTextEmpty(order.notes) ? null : order.notes ?? null,
    files: printFileNames(input.files),
    fileCountLabel: printFileCountLabel(printFileNames(input.files).length),
  };
}
