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

  it("keeps paragraph alignment of the existing notes and of the new note", () => {
    const existing = '<p data-text-align="center">Recoger en tienda</p>';
    assert.equal(
      appendOrderNote(existing, '<p data-text-align="right" style="text-align:left">Firma</p>'),
      `${existing}<p data-text-align="right">Firma</p>`
    );
  });

  it("keeps the text sizes and colors of the existing notes and of the new note", () => {
    const existing = '<p><span data-text-color="red">Cliente paga al recoger</span></p>';
    assert.equal(
      appendOrderNote(existing, '<p><span data-text-size="large" style="color:#000">Falta el reverso</span></p>'),
      `${existing}<p><span data-text-size="large">Falta el reverso</span></p>`
    );
  });
});
