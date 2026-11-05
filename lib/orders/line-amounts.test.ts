import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { canonicalRate, lineAmounts, normalizeDecimalInput, summarizeLines } from "./line-amounts";

type Vector = {
  note: string;
  quantity: string;
  unit_price: string;
  discount_percent: string;
  tax_rate: string;
  prices_include_tax: boolean;
  subtotal: string;
  tax_amount: string;
  total: string;
};

const fixtures = JSON.parse(readFileSync(new URL("./line-amounts.fixtures.json", import.meta.url), "utf8")) as { vectors: Vector[] };

describe("line amounts preview mirrors quote_line_amounts_v1", () => {
  it("has a meaningful parity set", () => {
    assert.ok(fixtures.vectors.length >= 20);
  });

  for (const vector of fixtures.vectors) {
    it(vector.note, () => {
      assert.deepEqual(lineAmounts(vector, vector.prices_include_tax), {
        subtotal: vector.subtotal,
        tax_amount: vector.tax_amount,
        total: vector.total,
      });
    });
  }

  it("rounds half away from zero, never banker's rounding", () => {
    assert.equal(lineAmounts({ quantity: "1", unit_price: "0.125" }, false)?.total, "0.13");
    assert.equal(lineAmounts({ quantity: "1", unit_price: "0.135" }, false)?.total, "0.14");
    assert.equal(lineAmounts({ quantity: "1", unit_price: "0.004999" }, false)?.total, "0.00");
  });

  it("accepts a decimal comma, like the order money inputs", () => {
    assert.equal(normalizeDecimalInput(" 1,5 "), "1.5");
    assert.deepEqual(lineAmounts({ quantity: "1,5", unit_price: "2,00", tax_rate: "21" }, false), { subtotal: "3.00", tax_amount: "0.63", total: "3.63" });
  });

  it("returns null for values the database would refuse", () => {
    for (const bad of [
      { quantity: "0", unit_price: "1" },
      { quantity: "-1", unit_price: "1" },
      { quantity: "1", unit_price: "-1" },
      { quantity: "01", unit_price: "1" },
      { quantity: "1", unit_price: "1.1234567" },
      { quantity: "1", unit_price: "1", tax_rate: "100.5" },
      { quantity: "1", unit_price: "1", discount_percent: "101" },
      { quantity: "abc", unit_price: "1" },
      { quantity: "", unit_price: "1" },
    ]) {
      assert.equal(lineAmounts(bad, true), null, JSON.stringify(bad));
    }
  });
});

describe("summarizeLines", () => {
  it("sums rounded lines and groups the breakdown by rate", () => {
    const summary = summarizeLines([
      { quantity: "3", unit_price: "10", discount_percent: "10", tax_rate: "21" },
      { quantity: "2", unit_price: "5.50", tax_rate: "10" },
      { quantity: "1", unit_price: "4", tax_rate: "21.000000" },
    ], false);
    assert.deepEqual(summary.lines.map((line) => line?.total), ["32.67", "12.10", "4.84"]);
    assert.equal(summary.subtotal, "42.00");
    assert.equal(summary.tax_total, "7.61");
    assert.equal(summary.total, "49.61");
    assert.deepEqual(summary.breakdown, [
      { tax_rate: "10", subtotal: "11.00", tax_amount: "1.10", total: "12.10" },
      { tax_rate: "21", subtotal: "31.00", tax_amount: "6.51", total: "37.51" },
    ]);
    assert.deepEqual(summary.invalid, []);
  });

  it("keeps prices as final amounts when VAT is included", () => {
    const summary = summarizeLines([
      { quantity: "1", unit_price: "10", tax_rate: "21" },
      { quantity: "2", unit_price: "5", tax_rate: "4" },
    ], true);
    assert.equal(summary.total, "20.00");
    assert.equal(summary.subtotal, "17.88");
    assert.equal(summary.tax_total, "2.12");
  });

  it("reports invalid lines and leaves them out of the totals", () => {
    const summary = summarizeLines([
      { quantity: "1", unit_price: "10", tax_rate: "21" },
      { quantity: "", unit_price: "10", tax_rate: "21" },
    ], false);
    assert.deepEqual(summary.invalid, [1]);
    assert.equal(summary.lines[1], null);
    assert.equal(summary.total, "12.10");
  });

  it("orders the breakdown numerically and shows 0 % as its own rate", () => {
    const summary = summarizeLines([
      { quantity: "1", unit_price: "1", tax_rate: "21" },
      { quantity: "1", unit_price: "1", tax_rate: "4" },
      { quantity: "1", unit_price: "1", tax_rate: "0" },
      { quantity: "1", unit_price: "1", tax_rate: "10.5" },
    ], false);
    assert.deepEqual(summary.breakdown.map((row) => row.tax_rate), ["0", "4", "10.5", "21"]);
  });

  it("empty list totals zero", () => {
    assert.deepEqual(summarizeLines([], true), { lines: [], subtotal: "0.00", tax_total: "0.00", total: "0.00", breakdown: [], invalid: [] });
  });
});

describe("canonicalRate", () => {
  it("normalises database rate text", () => {
    assert.equal(canonicalRate("21.000000"), "21");
    assert.equal(canonicalRate("10.500000"), "10.5");
    assert.equal(canonicalRate("0"), "0");
    assert.equal(canonicalRate(null), "0");
  });
});
