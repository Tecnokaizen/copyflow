import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Bold } from "lucide-react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PrintRichText } from "@/components/print/print-frame";
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

describe("text styles in rendered content", () => {
  const value =
    '<p><span data-text-size="large" data-text-color="red" style="position:fixed">Urgente</span> resto</p>';

  it("renders sizes and colors only where the field opts in", () => {
    const styled = renderToStaticMarkup(
      createElement(RichTextContent, { value, textStyles: true })
    );
    assert.match(styled, /<span data-text-size="large" data-text-color="red">Urgente<\/span> resto/);
    assert.equal(styled.includes("position:fixed"), false);

    const basic = renderToStaticMarkup(createElement(RichTextContent, { value }));
    assert.match(basic, /<p>Urgente resto<\/p>/);
    assert.equal(basic.includes("data-text-"), false);
  });

  it("prints order styles and keeps other print documents basic", () => {
    const order = renderToStaticMarkup(
      createElement(PrintRichText, { title: "Instrucciones", value, textStyles: true })
    );
    assert.match(order, /print-rich/);
    assert.match(order, /data-text-color="red"/);

    const quote = renderToStaticMarkup(
      createElement(PrintRichText, { title: "Descripción", value })
    );
    assert.equal(quote.includes("data-text-"), false);
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

describe("rich text toolbar controls", () => {
  it("renders custom controls in place, between the buttons", () => {
    const html = renderToStaticMarkup(
      createElement(RichTextToolbar, {
        buttons: [
          { label: "Negrita", icon: Bold, onClick: () => undefined },
          {
            label: "Tamaño del texto",
            control: createElement("button", { type: "button", "aria-label": "Tamaño del texto: Normal" }),
          },
          { label: "Cursiva", icon: Bold, onClick: () => undefined },
        ],
      })
    );
    const order = ["Negrita", "Tamaño del texto: Normal", "Cursiva"].map((label) => html.indexOf(`aria-label="${label}"`));
    assert.ok(order.every((index) => index >= 0), html);
    assert.deepEqual([...order].sort((a, b) => a - b), order);
  });
});
