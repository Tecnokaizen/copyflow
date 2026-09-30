import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Bold } from "lucide-react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RichTextContent } from "@/components/rich-text/rich-text-content";
import {
  RichTextToolbar,
  richTextFrameClassName,
  richTextToolbarClassName,
} from "@/components/rich-text/rich-text-editor";

describe("RichTextContent", () => {
  it("renders legacy line breaks as paragraphs without raw tags in the text", () => {
    const html = renderToStaticMarkup(
      createElement(RichTextContent, { value: "Línea uno\nLínea dos" })
    );
    assert.match(html, /<p>Línea uno<\/p><p>Línea dos<\/p>/);
    assert.equal(html.includes("&lt;p&gt;"), false);
  });

  it("does not render a script payload", () => {
    const html = renderToStaticMarkup(
      createElement(RichTextContent, {
        value: '<p>Hola</p><script>alert(1)</script>',
      })
    );
    assert.match(html, /Hola/);
    assert.equal(/<script/i.test(html), false);
  });
});

describe("rich text editor frame", () => {
  it("keeps the toolbar scroll inside the editor frame", () => {
    const html = renderToStaticMarkup(
      createElement(
        "div",
        { className: richTextFrameClassName },
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
    assert.match(html, /max-w-full/);
    assert.match(html, /overflow-hidden/);
    assert.match(html, new RegExp(richTextToolbarClassName.split(" ")[2]));
    assert.match(html, /overflow-x-auto/);
    assert.match(html, /role="toolbar"/);
    assert.match(html, /Negrita/);
  });
});
