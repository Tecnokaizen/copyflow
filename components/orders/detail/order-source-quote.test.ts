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

  it("sits above the order cards instead of inside the grid", () => {
    const workspace = readFileSync(new URL("./order-workspace.tsx", import.meta.url), "utf8");
    const band = workspace.indexOf("<OrderSourceQuote");
    // SUR4 E3: two columns from lg (work, files, notes, activity | summary,
    // payments and delivery); one column on mobile.
    const grid = workspace.indexOf("lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(18rem,22rem)]");
    assert.ok(band > -1);
    assert.ok(grid > band);
    const gridBody = workspace.slice(grid, workspace.indexOf("<ClientModal", grid));
    assert.equal(gridBody.includes("OrderSourceQuote"), false);
    assert.match(gridBody, /OrderSummary/);
    assert.match(gridBody, /OrderProduction/);
    assert.match(gridBody, /OrderFulfillment/);
    assert.match(gridBody, /OrderNotes/);
  });
});
