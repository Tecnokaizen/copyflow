import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

// These modules pull client-only dependencies the node runner cannot load (the
// layout tests also render them as markers), so the checks read the source.
// The rules themselves are unit-tested in lib/orders/invoice.test.ts,
// lib/orders/draft.ts and lib/orders/external-folder-url.test.ts.
const read = (file: string) => readFileSync(new URL(file, import.meta.url), "utf8");

describe("invoice fields in «Cobro y entrega»", () => {
  const source = read("./order-fulfillment.tsx");

  it("adds both rows, with «Factura entregada» only when an invoice is required", () => {
    assert.equal((source.match(/label="Requiere factura"/g) ?? []).length, 2, "edit and read modes");
    assert.equal((source.match(/label="Factura entregada"/g) ?? []).length, 2);
    assert.match(source, /\{draft\.invoice_required === true \? \(\s*<FactRow label="Factura entregada">/);
    assert.match(source, /\{order\.invoice_required === true \? \(\s*<FactRow label="Factura entregada">/);
  });

  it("offers Sin indicar / Sí / No and clears delivery when Sí is undone", () => {
    assert.equal((source.match(/<option value="">— Sin indicar —<\/option>/g) ?? []).length, 2);
    assert.match(source, /invoice_delivered: required === true \? draft\.invoice_delivered : null/);
    assert.match(source, /formatInvoiceFlag\(order\.invoice_required\)/);
  });
});

describe("«Ubicación externa de archivos» in «Trabajo»", () => {
  const source = read("./order-production.tsx");

  it("renames the field, takes free text and links only http(s)", () => {
    assert.equal(source.includes("Enlace a Drive"), false);
    assert.equal((source.match(/label="Ubicación externa de archivos"/g) ?? []).length, 2);
    assert.match(source, /placeholder="Enlace de Drive, Dropbox o ruta de red\.\.\."/);
    assert.equal(source.includes('type="url"'), false);
    assert.match(source, /const externalHref = externalLocationHref\(order\.external_folder_url\);/);
    assert.match(source, /href=\{externalHref\}/);
    assert.equal(/href=\{order\.external_folder_url\}/.test(source), false);
  });
});
