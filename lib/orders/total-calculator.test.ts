import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { OrderItemsState } from "./items";
import { ORDER_TAX_RATES, taxRateLabel, taxRateOptions } from "./tax-rates";
import {
  applyRateToAll,
  compareMoney,
  decimalForInput,
  describeConflict,
  directInputFor,
  duplicateRow,
  emptyRow,
  firstInvalidRow,
  hasDiscounts,
  initialMode,
  initialPricesIncludeTax,
  itemsPayload,
  removeRow,
  rowFromItem,
  summarizeRows,
} from "./total-calculator";

const state = (overrides: Partial<OrderItemsState> = {}): OrderItemsState => ({
  total_amount: "50.00", total_mode: "manual", prices_include_tax: false, items_subtotal: "0.00", items_tax_total: "0.00", items_total: "0.00", row_version: "3", items: [],
  ...overrides,
});
const item = {
  id: "i1", position: 1, concept: "Copias", description: "A4 color", quantity: "100", unit: "ud", unit_price: "0.1",
  discount_percent: "5", tax_rate: "10.5", subtotal: "9.50", tax_amount: "1.00", total: "10.50",
};

describe("tax rates", () => {
  it("offers 21/10/4/0 and keeps a saved rate outside the list", () => {
    assert.deepEqual([...ORDER_TAX_RATES], ["21", "10", "4", "0"]);
    assert.deepEqual(taxRateOptions("21"), ["21", "10", "4", "0"]);
    assert.deepEqual(taxRateOptions("10.5"), ["21", "10", "4", "0", "10.5"]);
    assert.equal(taxRateLabel("10.5"), "10,5 %");
    assert.equal(taxRateLabel("0"), "0 %");
  });
});

describe("initial state", () => {
  it("opens in concepts only when lines drive the total", () => {
    assert.equal(initialMode(state({ total_mode: "items" })), "items");
    assert.equal(initialMode(state()), "direct");
    assert.equal(initialMode(state({ items: [item] })), "direct");
  });

  it("takes the direct amount from the same snapshot as the version", () => {
    assert.equal(directInputFor(state({ total_amount: "12.30" })), "12,30");
    assert.equal(directInputFor(state({ total_amount: null })), "");
  });

  it("defaults to VAT included for a new calculation and keeps the saved choice", () => {
    assert.equal(initialPricesIncludeTax(state()), true);
    assert.equal(initialPricesIncludeTax(state({ items: [item], prices_include_tax: false })), false);
    assert.equal(initialPricesIncludeTax(state({ items: [item], prices_include_tax: true })), true);
  });

  it("loads saved lines for editing, discount and description included", () => {
    assert.deepEqual(rowFromItem(item, "k"), {
      key: "k", concept: "Copias", quantity: "100", unit_price: "0,10", tax_rate: "10.5", discount_percent: "5", description: "A4 color", unit: "ud",
    });
    assert.equal(decimalForInput("7.5"), "7,5");
    assert.equal(decimalForInput("3", 2), "3,00");
  });
});

describe("rows", () => {
  const rows = [{ ...emptyRow("a"), concept: "A", unit_price: "1" }, { ...emptyRow("b"), concept: "B", unit_price: "2" }];

  it("duplicates right after the source with a new key", () => {
    const next = duplicateRow(rows, 0, "c");
    assert.deepEqual(next.map((row) => row.key), ["a", "c", "b"]);
    assert.equal(next[1].concept, "A");
    assert.equal(duplicateRow(rows, 9, "c"), rows);
  });

  it("removes a row but never the last one", () => {
    assert.deepEqual(removeRow(rows, 0).map((row) => row.key), ["b"]);
    assert.equal(removeRow([rows[0]], 0).length, 1);
  });

  it("applies one rate to every row", () => {
    assert.deepEqual(applyRateToAll(rows, "4").map((row) => row.tax_rate), ["4", "4"]);
  });

  it("finds the first row that cannot be saved", () => {
    const bad = [rows[0], { ...rows[1], concept: " " }, { ...rows[1], unit_price: "" }];
    assert.equal(firstInvalidRow(bad, summarizeRows(bad, true)), 1);
    assert.equal(firstInvalidRow(rows, summarizeRows(rows, true)), null);
    const badNumber = [rows[0], { ...rows[1], quantity: "0" }];
    assert.equal(firstInvalidRow(badNumber, summarizeRows(badNumber, true)), 1);
  });

  it("detects saved discounts", () => {
    assert.equal(hasDiscounts(rows), false);
    assert.equal(hasDiscounts([{ ...rows[0], discount_percent: "5" }]), true);
    assert.equal(hasDiscounts([{ ...rows[0], discount_percent: "0.000000" }]), false);
  });
});

describe("itemsPayload", () => {
  it("sends decimal points, keeps discounts and never sends keys or amounts", () => {
    const payload = itemsPayload([{ ...rowFromItem(item, "k"), quantity: "1,5", unit_price: "2,40", concept: " Copias " }], true, "8");
    assert.deepEqual(payload, {
      expected_version: "8",
      prices_include_tax: true,
      items: [{ concept: "Copias", description: "A4 color", quantity: "1.5", unit: "ud", unit_price: "2.40", discount_percent: "5", tax_rate: "10.5" }],
    });
  });
});

describe("compareMoney", () => {
  it("compares exact money texts", () => {
    assert.equal(compareMoney("9.99", "10.00"), -1);
    assert.equal(compareMoney("10.00", "10.00"), 0);
    assert.equal(compareMoney("100.00", "99.99"), 1);
    assert.equal(compareMoney(null, "1.00"), null);
    assert.equal(compareMoney("1", "1.00"), null);
  });
});

describe("describeConflict", () => {
  const saved = (overrides: Partial<typeof item> = {}) => ({ ...item, ...overrides });
  const base = state({ total_mode: "items", total_amount: "10.50", items: [saved({ discount_percent: "0" })], row_version: "3" });

  it("someone changed the direct amount: shows before and now, overwrite sets the typed total", () => {
    const latest = state({ total_amount: "80.00", row_version: "4" });
    const c = describeConflict({ base: state({ row_version: "3" }), latest, mode: "direct", rows: [], inclusive: true, directAmount: "60.00" });
    assert.equal(c.total_before, "50.00");
    assert.equal(c.total_now, "80.00");
    assert.equal(c.lines_changed, false);
    assert.deepEqual(c.overwrite, { kind: "direct", total_to: "60.00", lines_become_reference: false });
  });

  it("someone saved other lines with a hidden discount: overwrite names the discount that would be lost", () => {
    const latest = state({
      total_mode: "items", total_amount: "9.98", row_version: "4",
      items: [saved({ id: "x1", discount_percent: "5", total: "9.98" }), saved({ id: "x2", concept: "Grapado", discount_percent: "0" })],
    });
    const draft = [rowFromItem(base.items[0], "a"), { ...emptyRow("b"), concept: "Plastificado", unit_price: "3" }];
    const c = describeConflict({ base, latest, mode: "items", rows: draft, inclusive: false, directAmount: null });
    assert.equal(c.lines_changed, true);
    assert.equal(c.overwrite.kind, "items");
    if (c.overwrite.kind !== "items") return;
    assert.equal(c.overwrite.replaced_lines, 2);
    assert.equal(c.overwrite.draft_lines, 2);
    assert.deepEqual(c.overwrite.lost_discounts, [{ concept: "Copias", discount_percent: "5" }]);
  });

  it("a discount the draft already carries is not reported as lost", () => {
    const withDiscount = saved({ discount_percent: "5" });
    const latest = state({ total_mode: "items", total_amount: "9.98", row_version: "4", items: [withDiscount] });
    const c = describeConflict({ base, latest, mode: "items", rows: [rowFromItem(withDiscount, "a")], inclusive: false, directAmount: null });
    assert.equal(c.overwrite.kind === "items" && c.overwrite.lost_discounts.length, 0);
  });

  it("only a VAT treatment change also counts as changed lines", () => {
    const latest = { ...base, prices_include_tax: true, row_version: "4" };
    assert.equal(describeConflict({ base, latest, mode: "items", rows: [], inclusive: false, directAmount: null }).lines_changed, true);
    assert.equal(describeConflict({ base, latest: { ...base, row_version: "4" }, mode: "items", rows: [], inclusive: false, directAmount: null }).lines_changed, false);
  });

  it("direct overwrite of an order that is now in items mode keeps the lines as reference", () => {
    const latest = state({ total_mode: "items", total_amount: "10.50", row_version: "4", items: [saved()] });
    const c = describeConflict({ base: state(), latest, mode: "direct", rows: [], inclusive: true, directAmount: "60.00" });
    assert.deepEqual(c.overwrite, { kind: "direct", total_to: "60.00", lines_become_reference: true });
    assert.equal(c.mode_before, "manual");
    assert.equal(c.mode_now, "items");
  });
});
