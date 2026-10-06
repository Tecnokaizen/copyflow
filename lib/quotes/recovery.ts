import { isUuid } from "@/lib/team/payload";
import { parseQuoteCreationPayload, type QuoteCreationPayload } from "./payload";
import { CLIENT_HEADER_FIELDS, type ClientHeaderField } from "./creation";
import type { ClientSummary } from "@/lib/clients/types";

export type PendingCreation = { payload: QuoteCreationPayload; client: ClientSummary | null; edited?: ClientHeaderField[] };
export type CreationReceipt = { operation_id: string; quote_id: string; reference: string; created_at: string; acknowledged_at: string | null };
export function operationStorageKey(tenant: string, actor: string, operation: string) {
  return `quote-creation:${tenant}:${actor}:${operation}`;
}
export function parsePendingCreation(raw: string | null, operation: string): PendingCreation | null {
  if (!raw) return null;
  const entry = JSON.parse(raw) as PendingCreation;
  const parsed = parseQuoteCreationPayload(entry.payload);
  if (!parsed.ok || parsed.data.creation_id !== operation) throw new Error('No se pudo recuperar el guardado pendiente. Conserva la URL y contacta con soporte.');
  return { payload: parsed.data, client: entry.client, edited: entry.edited?.filter(key => CLIENT_HEADER_FIELDS.includes(key)) };
}
export async function recoverCreations(operation?: string): Promise<CreationReceipt[]> {
  const response = await fetch(`/api/quotes/creation-recovery${operation ? `?op=${encodeURIComponent(operation)}` : ''}`, { cache: 'no-store' });
  const data = await response.json();
  if (!response.ok || !Array.isArray(data.receipts) || data.receipts.some((r: CreationReceipt) => !isUuid(r.operation_id) || r.quote_id !== r.operation_id || typeof r.reference !== 'string'))
    throw new Error('No se pudo comprobar si hay un presupuesto pendiente. Reintenta antes de crear otro.');
  return data.receipts;
}
export async function acknowledgeCreation(operation: string): Promise<void> {
  const response = await fetch('/api/quotes/creation-recovery', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operation_id: operation }) });
  const data = await response.json();
  if (!response.ok || data.quote_id !== operation) throw new Error('El presupuesto está guardado, pero no se pudo confirmar su recuperación. Reintenta o abre su ficha.');
}
// Web Locks coordinates same-operation tabs. SQL remains authoritative across browsers/devices.
export async function withCreationLock<T>(key: string, action: () => Promise<T>): Promise<T> {
  if (!navigator.locks) throw new Error('Este navegador no permite proteger el guardado entre pestañas. Abre el presupuesto en un navegador actualizado.');
  return navigator.locks.request(key, action);
}
