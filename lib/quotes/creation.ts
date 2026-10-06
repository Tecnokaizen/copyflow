import type { ClientSummary } from "@/lib/clients/types";
import type { QuoteDraftHeader, QuoteRecord } from "./types";
import type { EditorValues } from "./editor";
import type { QuoteCreationPayload } from "./payload";

export const CLIENT_HEADER_FIELDS = ['contact_name', 'contact_email', 'contact_phone', 'billing_name', 'tax_id'] as const;
export type ClientHeaderField = typeof CLIENT_HEADER_FIELDS[number];
export function clientHeader(client: ClientSummary | null): Pick<QuoteDraftHeader, ClientHeaderField> {
  return { contact_name: client?.contact_name || null, contact_email: client?.email || null,
    contact_phone: client?.phone || null, billing_name: client?.company_name?.trim() || client?.name || null, tax_id: client?.tax_id || null };
}
export function autofillClient(header: QuoteDraftHeader, client: ClientSummary | null, edited: ReadonlySet<ClientHeaderField>): QuoteDraftHeader {
  const next = { ...header }, source = clientHeader(client);
  for (const key of CLIENT_HEADER_FIELDS) if (!edited.has(key)) next[key] = source[key];
  return next;
}
export function newEditorValues(): EditorValues {
  return { header: { title: null, description: '', terms: null, ...clientHeader(null), billing_address: null,
    issue_date: new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid' }).format(new Date()),
    valid_until: null, currency: 'EUR', prices_include_tax: false }, items: [] };
}
export function creationPayload(id: string, values: EditorValues, clientId: string | null, serviceId: string, assigneeId: string, prepare: boolean): QuoteCreationPayload {
  return { creation_id: id, client_id: clientId, service_id: serviceId || null, assigned_team_member_id: assigneeId || null,
    header: values.header, items: values.items.map(({ concept, description, quantity, unit, unit_price, discount_percent, tax_rate }) =>
      ({ concept, description, quantity, unit, unit_price, discount_percent, tax_rate })), prepare };
}
export function commercialStatus(q: Pick<QuoteRecord, 'status' | 'current_version_state' | 'converted_order_id'>): { name: string; code: string } {
  if (q.converted_order_id) return { name: 'Convertido en pedido', code: 'accepted' };
  if (q.status?.code === 'accepted' || q.status?.code === 'rejected') return { name: q.status.code === 'accepted' ? 'Aceptado' : 'Rechazado', code: q.status.code };
  if (q.current_version_state) return { name: { draft: 'Borrador', prepared: 'Preparado', sent: 'Enviado' }[q.current_version_state], code: q.current_version_state };
  return { name: q.status?.name ?? 'Borrador', code: q.status?.code ?? 'draft' };
}
