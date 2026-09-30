import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  appendRichText,
  isRichTextEmpty,
  normalizeRichText,
  plainTextSnippet,
  richTextToPlainText,
  sanitizeRichText,
} from "./html";

describe("sanitizeRichText", () => {
  it("keeps bold, italic, underline and strike", () => {
    assert.match(sanitizeRichText("<strong>negrita</strong>"), /<strong>negrita<\/strong>/);
    assert.match(sanitizeRichText("<b>negrita</b>"), /<strong>negrita<\/strong>/);
    assert.match(sanitizeRichText("<em>cursiva</em>"), /<em>cursiva<\/em>/);
    assert.match(sanitizeRichText("<i>cursiva</i>"), /<em>cursiva<\/em>/);
    assert.match(sanitizeRichText("<u>sub</u>"), /<u>sub<\/u>/);
    assert.match(sanitizeRichText("<s>tacha</s>"), /<s>tacha<\/s>/);
    assert.match(sanitizeRichText("<strike>tacha</strike>"), /<s>tacha<\/s>/);
  });

  it("keeps bullet and ordered lists", () => {
    const html = sanitizeRichText("<ul><li>uno</li></ul><ol><li>dos</li></ol>");
    assert.match(html, /<ul><li>uno<\/li><\/ul>/);
    assert.match(html, /<ol><li>dos<\/li><\/ol>/);
  });

  it("keeps safe http, https and mailto links and adds rel", () => {
    const https = sanitizeRichText('<a href="https://gestcopy.com">web</a>');
    assert.match(https, /href="https:\/\/gestcopy\.com"/);
    assert.match(https, /rel="noopener noreferrer"/);

    const mailto = sanitizeRichText('<a href="mailto:hola@gestcopy.com">mail</a>');
    assert.match(mailto, /href="mailto:hola@gestcopy\.com"/);
  });

  it("removes javascript, data and ftp links", () => {
    for (const href of [
      "javascript:alert(1)",
      "data:text/html,hi",
      "ftp://files.example",
    ]) {
      const html = sanitizeRichText(`<a href="${href}">x</a>`);
      assert.equal(html.includes("<a"), false);
      assert.match(html, /x/);
    }
  });

  it("removes script, style, img and event handlers", () => {
    const html = sanitizeRichText(
      '<p onclick="alert(1)">Hola</p><script>alert(1)</script><style>p{color:red}</style><img src="x" onerror="alert(1)">'
    );
    assert.match(html, /<p>Hola<\/p>/);
    assert.equal(/script|style|img|onclick|onerror|color:red/i.test(html), false);
  });

  it("drops office fonts, sizes, colors and classes on paste", () => {
    const html = sanitizeRichText(
      '<p class="MsoNormal" style="color:red;font-family:Calibri;font-size:14pt"><span style="font-size:18pt">Hola</span> <b>mundo</b></p>'
    );
    assert.match(html, /<p>Hola <strong>mundo<\/strong><\/p>/);
    assert.equal(/style|class|font|color|Mso/i.test(html), false);
  });
});

describe("legacy and empty rich text", () => {
  it("renders legacy multiline text as paragraphs", () => {
    assert.equal(
      normalizeRichText("Línea uno\nLínea dos"),
      "<p>Línea uno</p><p>Línea dos</p>"
    );
  });

  it("keeps a legacy plain value readable", () => {
    assert.equal(richTextToPlainText("Línea uno\nLínea dos"), "Línea uno\nLínea dos");
    assert.equal(richTextToPlainText("Carteles <VIP>"), "Carteles <VIP>");
    assert.equal(normalizeRichText("  500 tarjetas "), "<p>500 tarjetas</p>");
  });

  it("treats visually empty markup as empty", () => {
    for (const value of [
      "",
      "   ",
      "<p></p>",
      "<p><br></p>",
      "<p>&nbsp;</p>",
      "<p> &nbsp; </p>",
      "<ul><li></li></ul>",
      "<ul><li><p></p></li></ul>",
      "<ol><li><br></li></ol>",
    ]) {
      assert.equal(isRichTextEmpty(value), true, value);
      assert.equal(normalizeRichText(value), "");
    }
  });

  it("extracts plain text and a single-line snippet", () => {
    const html = "<p>Hello <strong>bold</strong></p><p>next</p>";
    assert.equal(richTextToPlainText(html), "Hello bold\nnext");
    assert.equal(plainTextSnippet(html), "Hello bold next");
    assert.equal(plainTextSnippet("<p><strong>Negrita</strong></p>").includes("<"), false);
  });
});

describe("appendRichText", () => {
  it("appends canonical paragraphs and ignores empty additions", () => {
    assert.equal(
      appendRichText("Archivo recibido", "Falta el reverso"),
      "<p>Archivo recibido</p><p>Falta el reverso</p>"
    );
    assert.equal(
      appendRichText("<p>Archivo recibido</p>", "   "),
      "<p>Archivo recibido</p>"
    );
    assert.equal(appendRichText(null, "   "), "");
    assert.equal(appendRichText("", "<p>Nota</p>"), "<p>Nota</p>");
  });
});
