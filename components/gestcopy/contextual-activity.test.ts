import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "node:test";
import { ContextualActivity } from "./contextual-activity";

describe("contextual activity accordion", () => {
  it("stays closed and hides the timeline until opened", () => {
    const html = renderToStaticMarkup(
      createElement(
        ContextualActivity,
        { count: 12 },
        createElement("p", null, "Pedido creado"),
      ),
    );
    assert.match(html, /Actividad · 12/);
    assert.match(html, /aria-expanded="false"/);
    assert.equal(html.includes("Pedido creado"), false);
  });

  it("keeps the existing timeline when expanded", () => {
    const html = renderToStaticMarkup(
      createElement(
        ContextualActivity,
        { count: 2, defaultOpen: true },
        createElement("p", null, "Ana · Pedido creado"),
      ),
    );
    assert.match(html, /aria-expanded="true"/);
    assert.match(html, /Ana · Pedido creado/);
  });
});
