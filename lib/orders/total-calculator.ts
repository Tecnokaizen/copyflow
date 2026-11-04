/**
 * Editing state of the order total calculator ("Por conceptos"). Pure helpers so
 * the dialog stays thin and testable. Amounts shown while typing come from
 * summarizeLines (preview); saved amounts always come from the database.
 */
import { canonicalDecimal, MAX_ORDER_ITEMS, type OrderItem, type OrderItemInput, type OrderItemsState } from "./items";
import { normalizeDecimalInput, summarizeLines, type LinesSummary } from "./line-amounts";
import { DEFAULT_ORDER_TAX_RATE } from "./tax-rates";

export type CalculatorRow = {
  key: string;
  concept: string;
  quantity: string;
  unit_price: string;
  tax_rate: string;
  // Not editable in V1, but always sent back unchanged.
  discount_percent: string;
  description: string | null;
  unit: string | null;
};

export type CalculatorMode = "items" | "direct";

/** "0.1" → "0,10" (prices keep at least 2 decimals); "7.5" → "7,5". */
export function decimalForInput(value: string, minFraction = 0): string {
  const [whole, fraction = ""] = canonicalDecimal(value).split(".");
  const padded = fraction.padEnd(minFraction, "0");
  return padded ? `${whole},${padded}` : whole;
}

export function emptyRow(key: string, taxRate = DEFAULT_ORDER_TAX_RATE): CalculatorRow {
  return { key, concept: "", quantity: "1", unit_price: "", tax_rate: taxRate, discount_percent: "0", description: null, unit: null };
}

export function rowFromItem(item: OrderItem, key: string): CalculatorRow {
  return {
    key,
    concept: item.concept,
    quantity: decimalForInput(item.quantity),
    unit_price: decimalForInput(item.unit_price, 2),
    tax_rate: canonicalDecimal(item.tax_rate),
    discount_percent: canonicalDecimal(item.discount_percent),
    description: item.description,
    unit: item.unit,
  };
}

/**
 * Mode the dialog opens in: «Por conceptos» when the lines drive the total;
 * otherwise «Importe directo», the usual flow (concepts are one click away).
 */
export function initialMode(state: OrderItemsState): CalculatorMode {
  return state.total_mode === "items" ? "items" : "direct";
}

/** VAT included is the default for a new calculation; saved lines keep theirs. */
export function initialPricesIncludeTax(state: OrderItemsState): boolean {
  return state.items.length > 0 ? state.prices_include_tax : true;
}

export function duplicateRow(rows: CalculatorRow[], index: number, key: string): CalculatorRow[] {
  if (index < 0 || index >= rows.length || rows.length >= MAX_ORDER_ITEMS) return rows;
  return [...rows.slice(0, index + 1), { ...rows[index], key }, ...rows.slice(index + 1)];
}

export function removeRow(rows: CalculatorRow[], index: number): CalculatorRow[] {
  if (rows.length <= 1 || index < 0 || index >= rows.length) return rows;
  return rows.filter((_, i) => i !== index);
}

export function applyRateToAll(rows: CalculatorRow[], rate: string): CalculatorRow[] {
  return rows.map((row) => ({ ...row, tax_rate: rate }));
}

export function summarizeRows(rows: CalculatorRow[], inclusive: boolean): LinesSummary {
  return summarizeLines(rows, inclusive);
}

/** Index of the first row that cannot be saved (empty concept or invalid number). */
export function firstInvalidRow(rows: CalculatorRow[], summary: LinesSummary): number | null {
  const index = rows.findIndex((row, i) => !row.concept.trim() || summary.lines[i] === null);
  return index === -1 ? null : index;
}

export function hasDiscounts(rows: CalculatorRow[]): boolean {
  return rows.some((row) => canonicalDecimal(normalizeDecimalInput(row.discount_percent) || "0") !== "0");
}

/** Body for PUT /api/orders/[id]/items. */
export function itemsPayload(rows: CalculatorRow[], pricesIncludeTax: boolean, expectedVersion: string) {
  const items: OrderItemInput[] = rows.map((row) => ({
    concept: row.concept.trim(),
    description: row.description,
    quantity: normalizeDecimalInput(row.quantity),
    unit: row.unit,
    unit_price: normalizeDecimalInput(row.unit_price),
    discount_percent: normalizeDecimalInput(row.discount_percent) || "0",
    tax_rate: normalizeDecimalInput(row.tax_rate) || "0",
  }));
  return { expected_version: expectedVersion, prices_include_tax: pricesIncludeTax, items };
}

/** Compares two money texts ("12.30"); null when either is missing. */
export function compareMoney(a: string | null | undefined, b: string | null | undefined): number | null {
  if (!a || !b || !/^\d+\.\d{2}$/.test(a) || !/^\d+\.\d{2}$/.test(b)) return null;
  const x = BigInt(a.replace(".", ""));
  const y = BigInt(b.replace(".", ""));
  return x < y ? -1 : x > y ? 1 : 0;
}
