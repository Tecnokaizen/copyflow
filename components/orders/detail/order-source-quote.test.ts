import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "node:test";
import { OrderSourceQuote } from "./order-source-quote";

describe("order source quote band", () => {
  it("renders a compact full-width line with the same quote facts and link", () => {
    const html = renderToStaticMarkup(
      createElement(OrderSourceQuote, {
        quote: {
          id: "q1",
          reference: "P-0002",
          total: "116.00",
          currency: "EUR",
          status: "accepted",
          version_number: 3,
        },
      }),
    );

    assert.match(html, /Presupuesto origen/);
    assert.match(html, /P-0002/);
    assert.match(html, /116,00/);
    assert.match(html, /Aceptado/);
    assert.match(html, /v3/);
    assert.match(html, /href="\/quotes\/q1"/);
    assert.match(html, /Ver presupuesto/);
    assert.match(html, /flex-wrap/);
    assert.match(html, /justify-between/);
    assert.equal(html.includes("gc-section-title"), false);
  });

  it("sits above the four order cards instead of inside the grid", () => {
    const workspace = readFileSync(new URL("./order-workspace.tsx", import.meta.url), "utf8");
    const band = workspace.indexOf("<OrderSourceQuote");
    const grid = workspace.indexOf('className="grid gap-6 lg:grid-cols-2"');
    assert.ok(band > -1);
    assert.ok(grid > band);
    const gridBody = workspace.slice(grid, workspace.indexOf("</div>", grid));
    assert.equal(gridBody.includes("OrderSourceQuote"), false);
    assert.match(gridBody, /OrderSummary/);
    assert.match(gridBody, /OrderProduction/);
    assert.match(gridBody, /OrderFulfillment/);
    assert.match(gridBody, /OrderNotes/);
  });
});
