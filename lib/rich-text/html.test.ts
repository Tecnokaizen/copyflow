import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  appendRichText,
  isRichTextEmpty,
  normalizeRichText,
  persistRichText,
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
    assert.equal(normalizeRichText("  500 tarjetas "), "<p>500 tarjetas</p>");
  });

  it("escapes unknown angle brackets and normalizes known aliases", () => {
    assert.equal(
      normalizeRichText("Carteles <VIP>"),
      "<p>Carteles &lt;VIP&gt;</p>"
    );
    assert.equal(richTextToPlainText("Carteles <VIP>"), "Carteles <VIP>");
    assert.equal(normalizeRichText("2 < 5"), "<p>2 &lt; 5</p>");
    assert.equal(richTextToPlainText("2 < 5"), "2 < 5");

    const script = normalizeRichText("<script>alert(1)</script>");
    assert.equal(/<script\b/i.test(script), false);
    assert.match(script, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);

    assert.equal(
      normalizeRichText("<p>Hola <strong>mundo</strong></p>"),
      "<p>Hola <strong>mundo</strong></p>"
    );
    assert.equal(normalizeRichText("<b>Hola</b>"), "<strong>Hola</strong>");
    assert.equal(normalizeRichText("<i>Hola</i>"), "<em>Hola</em>");
    assert.equal(normalizeRichText("<strike>Hola</strike>"), "<s>Hola</s>");
    assert.equal(normalizeRichText("<del>Hola</del>"), "<s>Hola</s>");
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

describe("text styles (opt-in, order fields)", () => {
  const styled = { textStyles: true };

  it("keeps the allowed size and color tokens in a fixed attribute order", () => {
    assert.equal(
      sanitizeRichText('<p>Hola <span data-text-color="red" data-text-size="large">urgente</span></p>', styled),
      '<p>Hola <span data-text-size="large" data-text-color="red">urgente</span></p>'
    );
    assert.equal(
      normalizeRichText('<p><span data-text-color="blue"><span data-text-size="small">nota</span></span></p>', styled),
      '<p><span data-text-color="blue"><span data-text-size="small">nota</span></span></p>'
    );
    for (const size of ["small", "large", "xlarge"]) {
      assert.match(normalizeRichText(`<p><span data-text-size="${size}">x</span></p>`, styled), new RegExp(`data-text-size="${size}"`));
    }
    for (const color of ["red", "orange", "green", "blue", "purple"]) {
      assert.match(normalizeRichText(`<p><span data-text-color="${color}">x</span></p>`, styled), new RegExp(`data-text-color="${color}"`));
    }
  });

  it("drops values outside the palette, inline CSS, classes and handlers", () => {
    const html = normalizeRichText(
      '<p><span data-text-color="red" style="color:#000;background:url(https://x.test/a.png)" class="x" onclick="alert(1)" data-x="1">A</span>' +
        '<span data-text-color="Red">B</span><span data-text-color="#ff0000">C</span><span data-text-size="99px">D</span>' +
        '<span data-text-size="large;position:fixed">E</span><span data-text-color="javascript:alert(1)">F</span></p>',
      styled
    );
    assert.equal(html, '<p><span data-text-color="red">A</span>BCDEF</p>');
  });

  it("drops pasted office sizes and colors instead of mapping them", () => {
    assert.equal(
      sanitizeRichText('<p class="MsoNormal" style="color:red;font-size:14pt"><span style="font-size:18pt;color:#C00000">Hola</span> <font color="red" size="5">mundo</font></p>', styled),
      "<p>Hola mundo</p>"
    );
  });

  it("does not let a styled span carry scripts, images or unsafe links", () => {
    const html = normalizeRichText(
      '<p><span data-text-color="red"><script>alert(1)</script><img src=x onerror=alert(1)><a href="javascript:alert(1)">x</a><a href="https://ok.test">ok</a></span></p>',
      styled
    );
    assert.equal(html, '<p><span data-text-color="red">x<a href="https://ok.test" rel="noopener noreferrer">ok</a></span></p>');
    assert.equal(/script|img|onerror|javascript/i.test(html), false);
  });

  it("is stable across save, reload and edit cycles", () => {
    const saved = persistRichText(
      '<p><strong><span data-text-size="xlarge" data-text-color="red">NO CORTAR</span></strong> sangre 3 mm</p><ul><li><span data-text-color="green">Papel 350 g</span></li></ul>',
      styled
    );
    assert.ok(saved);
    assert.equal(normalizeRichText(saved, styled), saved);
    assert.equal(persistRichText(normalizeRichText(saved, styled), styled), saved);
    assert.equal(
      appendRichText(saved, '<p><span data-text-color="blue">Avisar al cliente</span></p>', styled),
      `${saved}<p><span data-text-color="blue">Avisar al cliente</span></p>`
    );
  });

  it("removes the styles where a field does not opt in (quotes, footer, kiosk, clients)", () => {
    const value = '<p><span data-text-size="large" data-text-color="red">Importante</span> texto</p>';
    assert.equal(normalizeRichText(value), "<p>Importante texto</p>");
    assert.equal(persistRichText(value), "<p>Importante texto</p>");
    assert.equal(appendRichText(value, "más"), "<p>Importante texto</p><p>más</p>");
  });

  it("plain text, snippets and emptiness ignore the tokens", () => {
    const value = '<p><span data-text-color="red">Rojo</span> y <span data-text-size="large">grande</span></p>';
    assert.equal(richTextToPlainText(value), "Rojo y grande");
    assert.equal(plainTextSnippet(value), "Rojo y grande");
    for (const empty of ['<p><span data-text-color="red"></span></p>', '<p><span data-text-size="large"> &nbsp; </span></p>']) {
      assert.equal(isRichTextEmpty(empty), true);
      assert.equal(normalizeRichText(empty, styled), "");
      assert.equal(persistRichText(empty, styled), null);
    }
  });

  it("leaves historical values exactly as before (no tokens: same output with and without styles)", () => {
    const corpus = [
      "",
      "   ",
      "Línea uno\nLínea dos",
      "  500 tarjetas ",
      "Carteles <VIP>",
      "2 < 5",
      "<script>alert(1)</script>",
      "<p>Hola <strong>mundo</strong></p>",
      "<b>Hola</b><i>x</i><strike>y</strike><del>z</del><u>u</u>",
      "<ul><li>uno</li></ul><ol><li>dos</li></ol>",
      '<p><a href="https://gestcopy.com/?a=1&amp;b=2">web</a> <a href="mailto:hola@gestcopy.com">mail</a> <a href="javascript:alert(1)">x</a></p>',
      '<p onclick="alert(1)">Hola</p><script>alert(1)</script><style>p{color:red}</style><img src="x" onerror="alert(1)">',
      '<p class="MsoNormal" style="color:red;font-family:Calibri;font-size:14pt"><span style="font-size:18pt">Hola</span> <b>mundo</b></p>',
      "<p>a<span> </span>b <span class=\"x\">c</span> <span data-foo=\"1\">d</span></p>",
      "<div><h1>Título</h1><table><tr><td>celda</td></tr></table></div>",
      "<p>&nbsp;</p><p><br></p><p>Fin &amp; ya</p>",
      "<p>Texto   con   espacios</p><p>Tab\tuno</p>",
      '<p style="text-align: center">Centrado de Word</p><p align="justify">Justificado</p><div style="text-align:right">Derecha</div>',
    ];
    const fragments = [
      "<p>", "</p>", "<span>", "</span>", '<span style="color:red">', '<span class="Mso">', '<span data-text-color="Rojo">',
      '<span data-text-size="12px">', '<p data-text-align="left">', '<p data-text-align="Center">', '<p style="text-align:center">',
      '<p align="right">', '<p data-text-align="right;color:red">', "<strong>", "</strong>", "<em>", "</em>", "<br>", "<ul><li>", "</li></ul>",
      '<a href="https://ok.test/x?y=1&z=2">', "</a>", "texto", " ", "&amp;", "&lt;b&gt;", "<", ">", "\n", "ñandú",
    ];
    let seed = 7;
    const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648);
    for (let i = 0; i < 400; i++) {
      corpus.push(Array.from({ length: 4 + (next() % 12) }, () => fragments[next() % fragments.length]).join(""));
    }
    for (const value of corpus) {
      assert.equal(normalizeRichText(value, styled), normalizeRichText(value), value);
      assert.equal(sanitizeRichText(value, styled), sanitizeRichText(value), value);
      assert.equal(persistRichText(value, styled), persistRichText(value), value);
    }
  });
});

describe("paragraph alignment (opt-in, order fields)", () => {
  const styled = { textStyles: true };

  it("keeps center, right and justify on paragraphs, also inside lists", () => {
    const html =
      '<p data-text-align="center">Centrada</p><p data-text-align="right">Derecha</p><p data-text-align="justify">Justificada</p>' +
      '<ul><li><p data-text-align="center">Punto centrado</p></li></ul><ol><li><p data-text-align="right">Paso</p></li></ol>';
    assert.equal(normalizeRichText(html, styled), html);
  });

  it("left is the default: never stored, and older text stays left-aligned", () => {
    assert.equal(normalizeRichText('<p data-text-align="left">Izquierda</p>', styled), "<p>Izquierda</p>");
    assert.equal(normalizeRichText("Línea uno\nLínea dos", styled), "<p>Línea uno</p><p>Línea dos</p>");
  });

  it("allows only the exact values, never CSS", () => {
    const html = normalizeRichText(
      '<p data-text-align="Center">a</p><p data-text-align=" right">b</p><p data-text-align="center;position:fixed">c</p>' +
        '<p data-text-align="start">d</p><p style="text-align:center">e</p><p align="right">f</p>' +
        '<p data-text-align="justify" style="color:red" class="x" onclick="alert(1)" data-x="1">g</p>',
      styled
    );
    assert.equal(html, '<p>a</p><p>b</p><p>c</p><p>d</p><p>e</p><p>f</p><p data-text-align="justify">g</p>');
  });

  it("only paragraphs carry alignment", () => {
    assert.equal(
      normalizeRichText('<p><span data-text-align="center">x</span> <strong data-text-align="right">y</strong></p><ul data-text-align="center"><li data-text-align="right"><p>z</p></li></ul>', styled),
      "<p>x <strong>y</strong></p><ul><li><p>z</p></li></ul>"
    );
  });

  it("combines with sizes, colors, bold, links and lists", () => {
    const html =
      '<p data-text-align="center"><strong><span data-text-size="xlarge"><span data-text-color="red">NO CORTAR</span></span></strong></p>' +
      '<p data-text-align="justify">Ver <a href="https://ok.test" rel="noopener noreferrer">ficha</a> y <em>muestra</em></p>' +
      '<ul><li><p data-text-align="right"><span data-text-color="green">Papel 350 g</span></p></li></ul>';
    assert.equal(normalizeRichText(html, styled), html);
    assert.equal(richTextToPlainText(html), "NO CORTAR\nVer ficha y muestra\nPapel 350 g");
  });

  it("is stable across save, reload, edit and append", () => {
    const saved = persistRichText('<p data-text-align="center">Título</p><p>Cuerpo</p>', styled);
    assert.equal(normalizeRichText(saved, styled), saved);
    assert.equal(
      appendRichText(saved, '<p data-text-align="right">Firma</p>', styled),
      `${saved}<p data-text-align="right">Firma</p>`
    );
  });

  it("an aligned empty paragraph is still empty", () => {
    assert.equal(isRichTextEmpty('<p data-text-align="center"></p><p data-text-align="right"><br></p>'), true);
    assert.equal(persistRichText('<p data-text-align="center"> </p>', styled), null);
  });

  it("fields without the option drop the alignment (quotes, footer, kiosk, clients)", () => {
    assert.equal(normalizeRichText('<p data-text-align="center">Presupuesto</p>'), "<p>Presupuesto</p>");
  });
});
