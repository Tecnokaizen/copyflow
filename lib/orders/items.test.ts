import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MAX_ORDER_ITEMS,
  canonicalDecimal,
  mapOrderItemsState,
  mapReplaceItemsResult,
  orderItemsError,
  parseOrderItemsPayload,
} from "./items";

const line = { concept: "Copias A4", description: null, quantity: "100", unit: "ud", unit_price: "0.10", discount_percent: "0", tax_rate: "21" };

describe("parseOrderItemsPayload", () => {
  it("accepts editable fields and canonicalises decimals for the database", () => {
    const result = parseOrderItemsPayload({
      expected_version: "7",
      prices_include_tax: true,
      items: [{ ...line, concept: "  Copias  ", quantity: "007.50", unit_price: "1.500000", tax_rate: "21.000000" }],
    });
    assert.ok(result.ok);
    assert.deepEqual(result.data, {
      expected_version: "7",
      prices_include_tax: true,
      items: [{ concept: "Copias", description: null, quantity: "7.5", unit: "ud", unit_price: "1.5", discount_percent: "0", tax_rate: "21" }],
    });
  });

  it("keeps an existing discount untouched", () => {
    const result = parseOrderItemsPayload({ expected_version: "1", prices_include_tax: false, items: [{ ...line, discount_percent: "12.5" }] });
    assert.ok(result.ok);
    assert.equal(result.data.items[0].discount_percent, "12.5");
  });

  it("never accepts ids or amounts from the client", () => {
    for (const extra of [{ id: "x" }, { total: "1.00" }, { subtotal: "1" }, { position: 1 }, { tax_amount: "0" }]) {
      const result = parseOrderItemsPayload({ expected_version: "1", prices_include_tax: false, items: [{ ...line, ...extra }] });
      assert.equal(result.ok, false, JSON.stringify(extra));
      assert.equal(!result.ok && result.index, 0);
    }
  });

  it("reports the first invalid line", () => {
    for (const bad of [{ concept: "   " }, { quantity: "0" }, { quantity: "-1" }, { unit_price: "-1" }, { tax_rate: "101" }, { unit_price: "1.1234567" }]) {
      const result = parseOrderItemsPayload({ expected_version: "1", prices_include_tax: false, items: [line, { ...line, ...bad }] });
      assert.equal(result.ok, false, JSON.stringify(bad));
      assert.equal(!result.ok && result.index, 1, JSON.stringify(bad));
    }
  });

  it("requires a version, the VAT mode and 1–500 lines", () => {
    assert.deepEqual(parseOrderItemsPayload({ prices_include_tax: true, items: [line] }), { ok: false, error: "conflict" });
    assert.deepEqual(parseOrderItemsPayload({ expected_version: 3, prices_include_tax: true, items: [line] }), { ok: false, error: "conflict" });
    assert.equal(parseOrderItemsPayload({ expected_version: "1", items: [line] }).ok, false);
    assert.equal(parseOrderItemsPayload({ expected_version: "1", prices_include_tax: true, items: [] }).ok, false);
    assert.equal(parseOrderItemsPayload({ expected_version: "1", prices_include_tax: true, items: Array(MAX_ORDER_ITEMS + 1).fill(line) }).ok, false);
    assert.equal(parseOrderItemsPayload({ expected_version: "1", prices_include_tax: true, items: Array(MAX_ORDER_ITEMS).fill(line) }).ok, true);
    assert.equal(parseOrderItemsPayload(null).ok, false);
  });
});

describe("canonicalDecimal", () => {
  it("drops leading and trailing zeros", () => {
    assert.equal(canonicalDecimal("007.50"), "7.5");
    assert.equal(canonicalDecimal("0.100000"), "0.1");
    assert.equal(canonicalDecimal("0.000"), "0");
    assert.equal(canonicalDecimal("21"), "21");
    assert.equal(canonicalDecimal("0"), "0");
  });
});

const order = {
  id: "o", total_mode: "items", prices_include_tax: true,
  items_subtotal: "20.00", items_tax_total: "4.20", items_total: "24.20", row_version: "12",
};
const row = {
  id: "i1", position: 1, concept: "Copias", description: null, quantity: "100.000000", unit: "ud",
  unit_price: "0.100000", discount_percent: "0.000000", tax_rate: "21.000000",
  subtotal: "8.26", tax_amount: "1.74", total: "10.00",
};

describe("mapOrderItemsState", () => {
  it("maps database text numerics exactly", () => {
    assert.deepEqual(mapOrderItemsState(order, [{ ...row, id: "i2", position: 2 }, row]), {
      total_mode: "items", prices_include_tax: true,
      items_subtotal: "20.00", items_tax_total: "4.20", items_total: "24.20", row_version: "12",
      items: [
        { id: "i1", position: 1, concept: "Copias", description: null, quantity: "100", unit: "ud", unit_price: "0.1", discount_percent: "0", tax_rate: "21", subtotal: "8.26", tax_amount: "1.74", total: "10.00" },
        { id: "i2", position: 2, concept: "Copias", description: null, quantity: "100", unit: "ud", unit_price: "0.1", discount_percent: "0", tax_rate: "21", subtotal: "8.26", tax_amount: "1.74", total: "10.00" },
      ],
    });
  });

  it("refuses rows that are not exact text (e.g. JSON numbers)", () => {
    assert.equal(mapOrderItemsState(order, [{ ...row, quantity: 100 }]), null);
    assert.equal(mapOrderItemsState({ ...order, items_total: 24.2 }, []), null);
    assert.equal(mapOrderItemsState({ ...order, total_mode: "other" }, []), null);
    assert.equal(mapOrderItemsState(order, null), null);
  });

  it("reads a manual order without lines", () => {
    assert.deepEqual(mapOrderItemsState({ ...order, total_mode: "manual", prices_include_tax: false, items_subtotal: "0.00", items_tax_total: "0.00", items_total: "0.00" }, [])?.items, []);
  });

  it("maps a replace_order_items_v1 response", () => {
    assert.equal(mapReplaceItemsResult({ ok: true, ...order, items: [row] })?.items.length, 1);
    assert.equal(mapReplaceItemsResult({ ok: false, error: "conflict" }), null);
  });
});

describe("orderItemsError", () => {
  it("maps database codes to Spanish messages and statuses", () => {
    assert.equal(orderItemsError("total_below_paid").status, 422);
    assert.match(orderItemsError("total_below_paid").error, /entregado a cuenta/);
    assert.equal(orderItemsError("conflict").status, 409);
    assert.equal(orderItemsError("forbidden").status, 403);
    assert.equal(orderItemsError("total_mode_items").status, 409);
    assert.equal(orderItemsError("whatever").status, 500);
  });
});
