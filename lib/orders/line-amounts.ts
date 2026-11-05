/**
 * Preview of order line amounts. Mirrors public.quote_line_amounts_v1 (the SQL
 * function quotes and order lines both use) so the calculator can show totals
 * while the user types.
 *
 * The database stays authoritative: replace_order_items_v1 calculates and stores
 * the amounts, and the UI repaints with what it returns. This module only
 * previews. lib/orders/line-amounts.fixtures.json is checked against this code
 * (Vitest) and against quote_line_amounts_v1 (supabase/tests/phase68_*), so both
 * must give the same cents.
 *
 * Rules (same as SQL):
 *   net = quantity × unit_price × (1 − discount/100)
 *   VAT included: base = net / (1 + rate/100), tax = net − base, total = net
 *   VAT excluded: base = net, tax = base × rate/100, total = base × (1 + rate/100)
 *   Each value is rounded per line to 2 decimals, half away from zero.
 *   Order totals are the sums of the rounded line values.
 *
 * Arithmetic is exact (BigInt fractions); no binary floating point is used.
 */

const SCALE = BigInt(1_000_000); // inputs carry at most 6 decimals

const QUANTITY = /^(0|[1-9]\d{0,11})(\.\d{1,6})?$/;
const PRICE = /^(0|[1-9]\d{0,11})(\.\d{1,6})?$/;
const PERCENT = /^(100(\.0{1,6})?|\d{1,2}(\.\d{1,6})?)$/;

export type LineAmountInput = {
  quantity: string;
  unit_price: string;
  discount_percent?: string | null;
  tax_rate?: string | null;
};

export type LineAmounts = { subtotal: string; tax_amount: string; total: string };

export type TaxBreakdownRow = LineAmounts & { tax_rate: string };

export type LinesSummary = {
  lines: (LineAmounts | null)[];
  subtotal: string;
  tax_total: string;
  total: string;
  breakdown: TaxBreakdownRow[];
  invalid: number[];
};

/** "1,5" → "1.5"; trims spaces. Does not validate. */
export function normalizeDecimalInput(value: string): string {
  return value.trim().replace(",", ".");
}

function scaled(value: string): bigint {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * SCALE + BigInt(fraction.padEnd(6, "0"));
}

export function isValidQuantity(value: string): boolean {
  return QUANTITY.test(value) && scaled(value) > BigInt(0);
}

export function isValidUnitPrice(value: string): boolean {
  return PRICE.test(value);
}

export function isValidPercent(value: string): boolean {
  return PERCENT.test(value);
}

/** Rounds num/den (both ≥ 0, den > 0) to cents, half away from zero. */
function cents(num: bigint, den: bigint): bigint {
  return (num * BigInt(200) + den) / (den * BigInt(2));
}

function money(value: bigint): string {
  const whole = value / BigInt(100);
  const fraction = (value % BigInt(100)).toString().padStart(2, "0");
  return `${whole}.${fraction}`;
}

function lineCents(input: LineAmountInput, inclusive: boolean) {
  const quantity = normalizeDecimalInput(input.quantity);
  const price = normalizeDecimalInput(input.unit_price);
  const discount = normalizeDecimalInput(input.discount_percent ?? "0") || "0";
  const rate = normalizeDecimalInput(input.tax_rate ?? "0") || "0";
  if (!isValidQuantity(quantity) || !isValidUnitPrice(price) || !isValidPercent(discount) || !isValidPercent(rate)) {
    return null;
  }
  const hundred = BigInt(100) * SCALE;
  const q = scaled(quantity);
  const p = scaled(price);
  const d = scaled(discount);
  const t = scaled(rate);
  // net = q·p·(100S − d) / (S³·100)
  const netNum = q * p * (hundred - d);
  const netDen = SCALE * SCALE * hundred;
  if (inclusive) {
    // base = net · 100S / (100S + t)
    const baseNum = netNum * hundred;
    const baseDen = netDen * (hundred + t);
    // tax = net − base = net · t / (100S + t)
    const taxNum = netNum * t;
    return { subtotal: cents(baseNum, baseDen), tax: cents(taxNum, baseDen), total: cents(netNum, netDen) };
  }
  return {
    subtotal: cents(netNum, netDen),
    tax: cents(netNum * t, netDen * hundred),
    total: cents(netNum * (hundred + t), netDen * hundred),
  };
}

/** Amounts of one line, or null when an input is not a valid decimal. */
export function lineAmounts(input: LineAmountInput, inclusive: boolean): LineAmounts | null {
  const result = lineCents(input, inclusive);
  if (!result) return null;
  return { subtotal: money(result.subtotal), tax_amount: money(result.tax), total: money(result.total) };
}

/** Canonical rate text for grouping: "21.000000" → "21", "10.5" → "10.5". */
export function canonicalRate(value: string | null | undefined): string {
  const text = normalizeDecimalInput(value ?? "0") || "0";
  if (!isValidPercent(text)) return text;
  const [whole, fraction = ""] = text.split(".");
  const trimmed = fraction.replace(/0+$/, "");
  return trimmed ? `${Number(whole)}.${trimmed}` : String(Number(whole));
}

/** Per-line amounts, order totals and the per-rate breakdown (sorted by rate). */
export function summarizeLines(items: LineAmountInput[], inclusive: boolean): LinesSummary {
  let subtotal = BigInt(0);
  let tax = BigInt(0);
  let total = BigInt(0);
  const invalid: number[] = [];
  const byRate = new Map<string, { subtotal: bigint; tax: bigint; total: bigint; scaled: bigint }>();
  const lines = items.map((item, index) => {
    const result = lineCents(item, inclusive);
    if (!result) {
      invalid.push(index);
      return null;
    }
    subtotal += result.subtotal;
    tax += result.tax;
    total += result.total;
    const rate = canonicalRate(item.tax_rate);
    const row = byRate.get(rate) ?? { subtotal: BigInt(0), tax: BigInt(0), total: BigInt(0), scaled: scaled(rate) };
    row.subtotal += result.subtotal;
    row.tax += result.tax;
    row.total += result.total;
    byRate.set(rate, row);
    return { subtotal: money(result.subtotal), tax_amount: money(result.tax), total: money(result.total) };
  });
  const breakdown = [...byRate.entries()]
    .sort((a, b) => (a[1].scaled < b[1].scaled ? -1 : a[1].scaled > b[1].scaled ? 1 : 0))
    .map(([rate, row]) => ({ tax_rate: rate, subtotal: money(row.subtotal), tax_amount: money(row.tax), total: money(row.total) }));
  return { lines, subtotal: money(subtotal), tax_total: money(tax), total: money(total), breakdown, invalid };
}
