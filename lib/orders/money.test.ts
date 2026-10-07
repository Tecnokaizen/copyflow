import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canonicalMoney, collectionLabel, formatOrderMoney } from "./money";

describe("order money strings", () => {
  it("keeps two decimal places without binary floating point", () => {
    assert.equal(canonicalMoney("200", false), "200.00");
    assert.equal(canonicalMoney("100,5", false), "100.50");
    assert.equal(canonicalMoney("0", false), null);
    assert.equal(canonicalMoney("-1.00", false), null);
    assert.equal(canonicalMoney("10.999", false), null);
    assert.equal(canonicalMoney("0", true), "0.00");
    assert.equal(formatOrderMoney("200.00"), "200,00 €");
    assert.equal(formatOrderMoney("1000.10"), "1.000,10 €");
    assert.equal(formatOrderMoney("99.99"), "99,99 €");
  });

  it("labels the derived collection state", () => {
    assert.equal(collectionLabel("undefined"), "Importe sin definir");
    assert.equal(collectionLabel("unpaid"), "Sin cobrar");
    assert.equal(collectionLabel("partial"), "Parcial");
    assert.equal(collectionLabel("paid"), "Cobrado");
  });
});
