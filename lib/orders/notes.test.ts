import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { appendOrderNote } from "./notes";

describe("appendOrderNote", () => {
  it("returns the trimmed note when there are no previous notes", () => {
    assert.equal(appendOrderNote(null, "  Llamar al cliente  "), "<p>Llamar al cliente</p>");
    assert.equal(appendOrderNote("", "Llamar al cliente"), "<p>Llamar al cliente</p>");
  });

  it("appends with a blank line without wiping prior notes", () => {
    assert.equal(
      appendOrderNote("Archivo recibido", "Falta el reverso"),
      "<p>Archivo recibido</p><p>Falta el reverso</p>"
    );
  });

  it("keeps existing notes when the addition is empty", () => {
    assert.equal(appendOrderNote("Archivo recibido", "   "), "<p>Archivo recibido</p>");
    assert.equal(appendOrderNote(null, "   "), null);
  });
});
