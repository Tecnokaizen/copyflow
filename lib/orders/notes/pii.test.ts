import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { detectPersonalData, personalDataWarning } from "./pii";

describe("post-it personal data detector (N2/N22)", () => {
  it("flags emails", () => {
    for (const text of [
      "Escribir a ana.perez@example.com antes de imprimir",
      "contacto: info@copisteria-sur.es",
      "MAIL: J_Lopez+pedidos@correo.co.uk",
    ]) {
      const match = detectPersonalData(text);
      assert.equal(match.email, true, text);
      assert.equal(match.any, true, text);
    }
  });

  it("flags Spanish mobiles and landlines in the usual formats", () => {
    for (const text of [
      "Llamar al 612345678",
      "Tel. 612 345 678",
      "tel.612.34.56.78",
      "Móvil 712-345-678",
      "Fijo 91 234 56 78",
      "Oficina 954 12 34 56",
      "+34 612 345 678",
      "+34612345678",
      "0034 612345678",
      "0034-612-34-56-78",
      "34 612 345 678",
      "(612 345 678)",
      "Teléfono:612345678.",
    ]) {
      const match = detectPersonalData(text);
      assert.equal(match.phone, true, text);
      assert.equal(match.any, true, text);
    }
  });

  it("ignores dates, times, amounts, quantities and order references", () => {
    for (const text of [
      "Entregar el 28/10/2026 a las 9:30",
      "Fecha 2026-10-28",
      "28.10.2026",
      "28-10-2026 18:45",
      "Total 1.234,56 €",
      "612.345.678,50 €",
      "A cuenta 60,00 € · Falta 940,50 €",
      "500 copias en A4, 90 g",
      "Pedido S4C-0020 y S4C-0021",
      "Presupuesto P-0001, versión 2",
      "CP 28001 Madrid",
      "Referencia 2026000123",
      "Nº de serie 1612345678",
      "Tarjeta 4111 1111 1111 1111",
      "Código 6123456789",
      "Cantidad 6123 unidades",
      "",
    ]) {
      const match = detectPersonalData(text);
      assert.deepEqual(match, { email: false, phone: false, any: false }, text);
    }
  });

  it("does not treat a bare @ or a handle as an email", () => {
    assert.equal(detectPersonalData("Reunión @ mostrador").email, false);
    assert.equal(detectPersonalData("Instagram @copisteria").email, false);
    assert.equal(detectPersonalData("ana@localhost").email, false);
  });

  it("handles null and non-breaking spaces", () => {
    assert.equal(detectPersonalData(null).any, false);
    assert.equal(detectPersonalData(undefined).any, false);
    assert.equal(detectPersonalData("612 345 678").phone, true);
  });

  it("only warns: a message per kind, none without a match", () => {
    assert.equal(personalDataWarning({ email: true, phone: true, any: true }), "Parece que contiene un email y un teléfono.");
    assert.equal(personalDataWarning({ email: true, phone: false, any: true }), "Parece que contiene un email.");
    assert.equal(personalDataWarning({ email: false, phone: true, any: true }), "Parece que contiene un teléfono.");
    assert.equal(personalDataWarning({ email: false, phone: false, any: false }), null);
  });
});
