import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

// The work sheet renders client-only icons the node runner cannot load, so the
// rule is checked in the source; the PDF twin is rendered in
// lib/print/receipt-pdf/render.test.ts.
describe("invoice boxes on the work sheet", () => {
  const source = readFileSync(new URL("./order-print-document.tsx", import.meta.url), "utf8");

  it("drops «Entregada» only when the answer is No (Sin indicar prints it empty)", () => {
    assert.match(source, /invoice\.required !== false \? <YesNo label="Entregada:"/);
    assert.equal(/invoice\.required === true \? <YesNo label="Entregada:"/.test(source), false);
  });
});
