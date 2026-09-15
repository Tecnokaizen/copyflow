import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatFactLabel } from "./fact-label";

describe("formatFactLabel", () => {
  it("appends a colon to a plain field label", () => {
    assert.equal(formatFactLabel("Cliente"), "Cliente:");
    assert.equal(formatFactLabel("Entrega prevista"), "Entrega prevista:");
  });

  it("does not duplicate a colon that is already there", () => {
    assert.equal(formatFactLabel("Contacto:"), "Contacto:");
    assert.equal(formatFactLabel("  Canal:  "), "Canal:");
  });
});
