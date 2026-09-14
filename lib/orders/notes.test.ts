import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { appendOrderNote } from "./notes";

describe("appendOrderNote", () => {
  it("returns the trimmed note when there are no previous notes", () => {
    assert.equal(appendOrderNote(null, "  Llamar al cliente  "), "Llamar al cliente");
    assert.equal(appendOrderNote("", "Llamar al cliente"), "Llamar al cliente");
  });

  it("appends with a blank line without wiping prior notes", () => {
    assert.equal(
      appendOrderNote("Archivo recibido", "Falta el reverso"),
      "Archivo recibido\n\nFalta el reverso"
    );
  });

  it("keeps existing notes when the addition is empty", () => {
    assert.equal(appendOrderNote("Archivo recibido", "   "), "Archivo recibido");
    assert.equal(appendOrderNote(null, "   "), null);
  });
});
