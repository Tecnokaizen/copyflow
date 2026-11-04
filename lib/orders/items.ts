/**
 * Order lines (Order Lines V1): read model, write payload and error mapping for
 * /api/orders/[id]/items. Amounts always come from the database
 * (replace_order_items_v1 → quote_line_amounts_v1); this module never computes
 * a stored amount. Line validation reuses the quote draft rules.
 */
import { parseCommercialItem } from "@/lib/quotes/payload";

export const MAX_ORDER_ITEMS = 500;

export type OrderTotalMode = "manual" | "items";

export type OrderItemInput = {
  concept: string;
  description: string | null;
  quantity: string;
  unit: string | null;
  unit_price: string;
  discount_percent: string;
  tax_rate: string;
};

export type OrderItem = OrderItemInput & {
  id: string;
  position: number;
  subtotal: string;
  tax_amount: string;
  total: string;
};

export type OrderItemsState = {
  total_mode: OrderTotalMode;
  prices_include_tax: boolean;
  items_subtotal: string;
  items_tax_total: string;
  items_total: string;
  row_version: string;
  items: OrderItem[];
};

export type OrderItemsPayload = {
  expected_version: string;
  prices_include_tax: boolean;
  items: OrderItemInput[];
};

/** PostgREST select lists that return numerics as exact text. */
export const ORDER_ITEMS_ORDER_SELECT =
  "id,total_mode,prices_include_tax,items_subtotal::text,items_tax_total::text,items_total::text,row_version::text";
export const ORDER_ITEMS_SELECT =
  "id,position,concept,description,quantity::text,unit,unit_price::text,discount_percent::text,tax_rate::text,subtotal::text,tax_amount::text,total::text";

const MONEY = /^\d+\.\d{2}$/;
const DECIMAL = /^\d+(\.\d+)?$/;

type Fail = { ok: false; error: string; index?: number };

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/**
 * "007.50" → "7.50", "1.500000" → "1.5", "0.000" → "0". The database accepts
 * no leading zeros; trailing zeros are dropped so stored "21.000000" reads "21".
 */
export function canonicalDecimal(value: string): string {
  const [rawWhole, rawFraction = ""] = value.split(".");
  const whole = rawWhole.replace(/^0+(?=\d)/, "");
  const fraction = rawFraction.replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

const INVALID = "Revisa las partidas: concepto, cantidad, precio e IVA.";

export function parseOrderItemsPayload(body: unknown): { ok: true; data: OrderItemsPayload } | Fail {
  const payload = record(body);
  if (!payload) return { ok: false, error: INVALID };
  const version = payload.expected_version;
  if (typeof version !== "string" || !/^[0-9]+$/.test(version)) {
    return { ok: false, error: "conflict" };
  }
  if (typeof payload.prices_include_tax !== "boolean") return { ok: false, error: INVALID };
  if (!Array.isArray(payload.items) || payload.items.length === 0) {
    return { ok: false, error: "Añade al menos una partida." };
  }
  if (payload.items.length > MAX_ORDER_ITEMS) {
    return { ok: false, error: `Un pedido admite como máximo ${MAX_ORDER_ITEMS} partidas.` };
  }
  const items: OrderItemInput[] = [];
  for (const [index, raw] of payload.items.entries()) {
    const line = record(raw);
    // Only editable fields: ids and amounts are never accepted from the client.
    if (!line || Object.keys(line).some((key) => !["concept", "description", "quantity", "unit", "unit_price", "discount_percent", "tax_rate"].includes(key))) {
      return { ok: false, error: INVALID, index };
    }
    const parsed = parseCommercialItem(line);
    if (!parsed.ok || !parsed.data.concept?.trim()) return { ok: false, error: INVALID, index };
    const item = parsed.data;
    items.push({
      concept: item.concept.trim(),
      description: item.description ?? null,
      quantity: canonicalDecimal(String(item.quantity)),
      unit: item.unit ?? null,
      unit_price: canonicalDecimal(String(item.unit_price)),
      discount_percent: canonicalDecimal(String(item.discount_percent ?? "0")),
      tax_rate: canonicalDecimal(String(item.tax_rate ?? "0")),
    });
  }
  return { ok: true, data: { expected_version: version, prices_include_tax: payload.prices_include_tax, items } };
}

function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function money(value: unknown): string | null {
  return typeof value === "string" && MONEY.test(value) ? value : null;
}

function decimal(value: unknown): string | null {
  return typeof value === "string" && DECIMAL.test(value) ? canonicalDecimal(value) : null;
}

function mapItem(value: unknown): OrderItem | null {
  const row = record(value);
  if (!row) return null;
  const id = text(row.id);
  const concept = text(row.concept);
  const quantity = decimal(row.quantity);
  const unitPrice = decimal(row.unit_price);
  const discount = decimal(row.discount_percent);
  const rate = decimal(row.tax_rate);
  const subtotal = money(row.subtotal);
  const tax = money(row.tax_amount);
  const total = money(row.total);
  const position = typeof row.position === "number" && Number.isInteger(row.position) ? row.position : null;
  if (!id || !concept || !quantity || !unitPrice || !discount || !rate || !subtotal || !tax || !total || position === null) {
    return null;
  }
  return {
    id, position, concept,
    description: text(row.description),
    quantity, unit: text(row.unit), unit_price: unitPrice, discount_percent: discount, tax_rate: rate,
    subtotal, tax_amount: tax, total,
  };
}

/** Builds the read model from the order row and its lines (DB text numerics). */
export function mapOrderItemsState(order: unknown, rows: unknown): OrderItemsState | null {
  const row = record(order);
  if (!row || !Array.isArray(rows)) return null;
  const mode = row.total_mode === "items" || row.total_mode === "manual" ? row.total_mode : null;
  const subtotal = money(row.items_subtotal);
  const tax = money(row.items_tax_total);
  const total = money(row.items_total);
  const version = typeof row.row_version === "string" && /^[0-9]+$/.test(row.row_version) ? row.row_version : null;
  if (!mode || typeof row.prices_include_tax !== "boolean" || !subtotal || !tax || !total || !version) return null;
  const items: OrderItem[] = [];
  for (const value of rows) {
    const item = mapItem(value);
    if (!item) return null;
    items.push(item);
  }
  items.sort((a, b) => a.position - b.position);
  return {
    total_mode: mode,
    prices_include_tax: row.prices_include_tax,
    items_subtotal: subtotal,
    items_tax_total: tax,
    items_total: total,
    row_version: version,
    items,
  };
}

/** Read model from a successful replace_order_items_v1 response. */
export function mapReplaceItemsResult(value: unknown): OrderItemsState | null {
  const row = record(value);
  if (!row || row.ok !== true) return null;
  return mapOrderItemsState(row, row.items);
}

const ITEMS_ERRORS: Record<string, { status: number; error: string }> = {
  not_found: { status: 404, error: "No se encontró el pedido" },
  forbidden: { status: 403, error: "No tienes permiso para modificar el importe del pedido" },
  conflict: { status: 409, error: "El pedido cambió. Recarga la ficha e inténtalo de nuevo." },
  order_archived: { status: 409, error: "El pedido archivado no admite cambios de importe." },
  invalid_items: { status: 422, error: INVALID },
  invalid_total_mode: { status: 422, error: INVALID },
  items_required: { status: 422, error: "Añade al menos una partida." },
  too_many_items: { status: 422, error: `Un pedido admite como máximo ${MAX_ORDER_ITEMS} partidas.` },
  total_below_paid: { status: 422, error: "El total no puede quedar por debajo de lo ya entregado a cuenta." },
  amount_overflow: { status: 422, error: "El importe es demasiado grande." },
  invalid_amount: { status: 422, error: "El importe no es válido." },
  total_mode_items: { status: 409, error: "El total de este pedido sale de sus partidas. Cambia a «Importe directo» para escribirlo a mano." },
};

export function orderItemsError(code: string | null | undefined) {
  return ITEMS_ERRORS[code ?? ""] ?? { status: 500, error: "No se pudo guardar el importe del pedido." };
}
