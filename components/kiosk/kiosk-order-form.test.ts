import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { Bold } from "lucide-react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RichTextToolbar } from "@/components/rich-text/rich-text-editor";

const source = readFileSync(
  new URL("./kiosk-order-form.tsx", import.meta.url),
  "utf8"
);

describe("Kiosk description editor", () => {
  it("keeps the toolbar out of a label", () => {
    const editorAt = source.indexOf("<RichTextEditor");
    assert.equal(editorAt > 0, true);
    const before = source.slice(0, editorAt);
    const divAt = before.lastIndexOf(
      '<div className="grid gap-2 text-sm font-semibold text-foreground">'
    );
    const labelAt = before.lastIndexOf("<label");
    const fieldAt = before.lastIndexOf("<Field");
    assert.equal(divAt > labelAt, true);
    assert.equal(divAt > fieldAt, true);
    assert.equal(source.slice(divAt, editorAt).includes("<label"), false);
    assert.equal(source.slice(divAt, editorAt).includes("<Field"), false);
    assert.match(source, /ariaLabel="Descripción del pedido"/);

    const html = renderToStaticMarkup(
      createElement(
        "div",
        { className: "grid gap-2 text-sm font-semibold text-foreground" },
        createElement("div", null, "Descripción *"),
        createElement(RichTextToolbar, {
          buttons: [
            {
              label: "Negrita",
              icon: Bold,
              onClick: () => undefined,
            },
          ],
        })
      )
    );
    assert.match(html, /role="toolbar"/);
    assert.equal(/<label[\s>]/i.test(html), false);
  });
});
