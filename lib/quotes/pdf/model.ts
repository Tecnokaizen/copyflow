import { richTextToPlainText } from "@/lib/rich-text/html";
import { brandColorFromBranding } from "@/lib/tenant/branding";
import { mapQuoteItem, mapQuoteVersion, type QuoteItem, type QuoteVersion } from "@/lib/quotes/types";

export function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function text(value: unknown): string { return typeof value === "string" ? value.trim() : ""; }
export type DocumentParty = { name: string; contact: string; taxId: string; address: string; email: string; phone: string };
export type QuoteDocumentModel = {
  templateCode: "commercial-v1"; reference: string; version: QuoteVersion; items: QuoteItem[];
  seller: DocumentParty; client: DocumentParty; brandColor: string; description: string; terms: string;
};
// This projection is a whitelist. Never spread quotes, snapshots or internal fields into the renderer.
export function quoteDocumentModel(reference: string, source: unknown, rows: unknown[]): QuoteDocumentModel {
  const raw = record(source);
  const version = mapQuoteVersion(raw);
  if (!version || !["prepared", "sent"].includes(version.state) || !version.locked_at) throw new Error("version_not_prepared");
  const items = rows.map(mapQuoteItem);
  if (!items.length || items.some((item) => !item)) throw new Error("invalid_document_items");
  const seller = record(raw.seller_snapshot), client = record(raw.client_snapshot);
  return {
    templateCode: "commercial-v1", reference, version,
    items: (items as QuoteItem[]).sort((a, b) => a.position - b.position),
    seller: { name: text(seller.business_name), contact: "", taxId: text(seller.tax_id), address: text(seller.billing_address), email: text(seller.email), phone: text(seller.phone) },
    client: { name: text(client.billing_name) || text(client.name), contact: text(client.contact_name), taxId: text(client.tax_id), address: text(client.billing_address), email: text(client.contact_email), phone: text(client.contact_phone) },
    brandColor: brandColorFromBranding(seller.branding) || "#163b4c",
    description: richTextToPlainText(version.description), terms: richTextToPlainText(version.terms),
  };
}
// Format decimal strings without floating point: DB numeric(20,2) exceeds JS safe integers.
export function documentMoney(value: string, currency: string): string {
  const [whole, fraction = ""] = value.split(".");
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${fraction.padEnd(2, "0").slice(0, 2)} ${currency}`;
}
export function documentDate(value: string | null): string {
  if (!value) return "Sin fecha";
  const [year, month, day] = value.split("-"); return `${day}/${month}/${year}`;
}

export function documentUnitPrice(value: string, currency: string): string {
  const [whole, raw = ""] = value.split(".");
  const fraction = raw.replace(/0+$/, "").padEnd(2, "0");
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${fraction} ${currency}`;
}

export function documentNumber(value: string): string {
  const [whole, raw = ""] = value.split(".");
  const fraction = raw.replace(/0+$/, "");
  return fraction ? `${whole},${fraction}` : whole;
}
