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
    // Order Detail Views V1: the classic layout places the modules; the
    // modules file builds <OrderSourceQuote> once.
    const modules = readFileSync(new URL("./order-detail-modules.tsx", import.meta.url), "utf8");
    assert.match(modules, /sourceQuote: sourceQuote \? <OrderSourceQuote quote=\{sourceQuote\} \/> : null/);
    const workspace = readFileSync(new URL("./views/classic-layout.tsx", import.meta.url), "utf8");
    const band = workspace.indexOf("{modules.sourceQuote}");
    // SUR4 E3: two columns from lg (work, files, notes, activity | summary,
    // payments and delivery); one column on mobile.
    const grid = workspace.indexOf("lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(18rem,22rem)]");
    assert.ok(band > -1);
    assert.ok(grid > band);
    const gridBody = workspace.slice(grid);
    assert.equal(gridBody.includes("sourceQuote"), false);
    assert.match(gridBody, /modules\.summary/);
    assert.match(gridBody, /modules\.production/);
    assert.match(gridBody, /modules\.fulfillment/);
    assert.match(gridBody, /modules\.legacyNotes/);
  });
});
