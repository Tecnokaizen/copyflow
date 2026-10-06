import { isRichTextEmpty } from "@/lib/rich-text/html";
import type { QuoteCommercialDetail, QuoteDraftHeader, QuoteDraftItemInput, QuoteDraftPayload } from "./types";

export const VERSION_LABELS = { draft: "Borrador", prepared: "Preparada · bloqueada", sent: "Enviada · bloqueada" };
export type EditorItem = QuoteDraftItemInput & { key: string };
export type EditorValues = { header: QuoteDraftHeader; items: EditorItem[] };
export function editorValues(detail: QuoteCommercialDetail): EditorValues {
  const { quote: q, current_version: v } = detail;
  return { header: {
    title: v?.title ?? q.title, description: v?.description ?? q.description,
    terms: v?.terms ?? q.notes, issue_date: v?.issue_date ?? q.issue_date,
    valid_until: v?.valid_until ?? q.valid_until, currency: v?.currency ?? q.currency,
    prices_include_tax: v?.prices_include_tax ?? q.prices_include_tax,
    contact_name: q.contact_name, contact_email: q.contact_email, contact_phone: q.contact_phone,
    billing_name: q.billing_name, tax_id: q.tax_id, billing_address: q.billing_address,
  }, items: detail.items.map((item) => ({ ...item, key: item.id })) };
}
export function emptyEditorItem(key: string): EditorItem {
  return { key, concept: "", description: null, quantity: "1", unit: "ud", unit_price: "0", discount_percent: "0", tax_rate: "21" };
}
export function moveEditorItem(items: EditorItem[], index: number, offset: number) {
  const next = [...items]; const target = index + offset;
  if (target < 0 || target >= items.length) return items;
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}
export function editorValidation(values: EditorValues): string[] {
  const errors: string[] = [];
  if (isRichTextEmpty(values.header.description)) errors.push("La descripción del trabajo es obligatoria.");
  if (!values.header.issue_date) errors.push("Indica la fecha de emisión.");
  if (!/^[A-Z]{3}$/.test(values.header.currency)) errors.push("La moneda debe tener tres letras (por ejemplo, EUR).");
  if (values.items.length > 500) errors.push("El máximo es de 500 partidas.");
  values.items.forEach((item, index) => {
    const prefix = `Partida ${index + 1}: `;
    if (!item.concept.trim()) errors.push(prefix + "el concepto es obligatorio.");
    for (const [key, label, positive, max] of [
      ["quantity", "cantidad", true, Infinity], ["unit_price", "precio unitario", false, Infinity],
      ["discount_percent", "descuento", false, 100], ["tax_rate", "IVA", false, 100],
    ] as const) {
      const value = item[key]; const n = Number(value);
      if (!/^\d+(\.\d{1,6})?$/.test(value) || !Number.isFinite(n) || (positive ? n <= 0 : n < 0) || n > max)
        errors.push(prefix + `${label} inválido${key === "discount_percent" ? " (0–100 %)" : ""}.`);
    }
  });
  return errors;
}
export function draftPayload(detail: QuoteCommercialDetail, values: EditorValues): QuoteDraftPayload {
  if (!detail.current_version || detail.current_version.state !== "draft") throw new Error("Esta versión está bloqueada.");
  return {
    version_id: detail.current_version.id, expected_row_version: detail.current_version.row_version,
    header: values.header,
    items: values.items.map(({ concept, description, quantity, unit, unit_price, discount_percent, tax_rate }) =>
      ({ concept, description, quantity, unit, unit_price, discount_percent, tax_rate })),
  };
}
export function formatQuoteMoney(value: string | undefined, currency = "EUR") {
  if (value == null) return "—";
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "—";
  // Display only. All arithmetic and final amounts belong to PostgreSQL.
  try { return new Intl.NumberFormat("es-ES", { style: "currency", currency }).format(amount); }
  catch { return `${value} ${currency}`; }
}
