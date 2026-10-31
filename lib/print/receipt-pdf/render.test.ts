import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PDFDocument } from "pdf-lib";

import { customerReceiptModel, type CustomerReceiptSource } from "@/lib/print/receipt";
import { drawnLines } from "@/lib/quotes/pdf/pdf-inspect";
import { ALL_WITNESSES, baseInput, PRIVATE, witnessOrder } from "./fixture";
import { renderCustomerReceiptPdf } from "./render";

describe("customer receipt PDF (E4)", () => {
  it("draws the receipt with the configured footer and page numbers, and no witness", async () => {
    const model = customerReceiptModel(witnessOrder() as CustomerReceiptSource, baseInput);
    const buffer = await renderCustomerReceiptPdf(model, undefined, new Date("2026-10-28T10:00:00.000Z"));
    assert.equal(buffer.subarray(0, 5).toString(), "%PDF-");
    const pdf = await PDFDocument.load(buffer);
    assert.equal(pdf.getTitle(), "Resguardo S4C-0020");
    const text = pdf.getPages().flatMap((page) => drawnLines(pdf, page).map((line) => line.text)).join("\n");
    for (const expected of ["RESGUARDO", "S4C-0020", "Impreso: 28/10/2026, 11:00", "Encuadernaciones Magerit", "Cliente Uno",
      "Total del pedido", "1.250,00 €", "Lugar de recogida", "Tienda Centro", "DESCRIPCIÓN DEL TRABAJO", "Tapa dura, 25 ejemplares.",
      "Taller Norte · Calle Mayor 1 · 910 000 000", "1 / 1"]) {
      assert.ok(text.includes(expected), expected);
    }
    for (const forbidden of [...ALL_WITNESSES, ...PRIVATE]) assert.equal(text.includes(forbidden), false, forbidden);
    assert.equal(buffer.toString("latin1").includes("TESTIGO"), false);
  });

  it("paginates a long description and numbers every page", async () => {
    const long = Array.from({ length: 120 }, (_, index) => `<p>Línea ${index + 1} de la descripción del trabajo.</p>`).join("");
    const model = customerReceiptModel({ ...witnessOrder(), description: long } as CustomerReceiptSource, baseInput);
    const pdf = await PDFDocument.load(await renderCustomerReceiptPdf(model));
    assert.ok(pdf.getPageCount() > 1);
    pdf.getPages().forEach((page, index) => {
      const lines = drawnLines(pdf, page).map((line) => line.text);
      assert.ok(lines.includes(`${index + 1} / ${pdf.getPageCount()}`));
      assert.ok(lines.includes("RESGUARDO"), "the header repeats on every page");
    });
  });
});
