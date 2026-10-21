import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PDFDocument } from "pdf-lib";
import { anfreFixture } from "./fixture";
import { wrapFooterLine, type FooterMeasure } from "./footer";
import { quoteDocumentModel, type QuoteDocumentModel } from "./model";
import { drawnLines, type DrawnLine } from "./pdf-inspect";
import { FOOTER_BOX_WIDTH, quoteFooterLines, renderQuotePdf } from "./render";

// Generic tenant data only.
const PAGE_RIGHT_EDGE = 40 + FOOTER_BOX_WIDTH;
const PAGE_LABEL = /^\d+ \/ \d+$/;

function modelWithFooter(quoteFooter: string): QuoteDocumentModel {
  const f = anfreFixture();
  const version = { ...f.version, seller_snapshot: { ...f.version.seller_snapshot, branding: { quote_footer: quoteFooter } } };
  return quoteDocumentModel(f.reference, version, f.items);
}
/** Lines drawn below the body: the body never goes under paddingBottom (58 + 12 per printed line). */
function footerBand(lines: DrawnLine[], printed: number) {
  return lines.filter((line) => line.y < 58 + 12 * printed && !PAGE_LABEL.test(line.text));
}
async function printedFooter(model: QuoteDocumentModel) {
  const expected = await quoteFooterLines(model.footer);
  const pdf = await PDFDocument.load(await renderQuotePdf(model));
  const pages = pdf.getPages().map((page) => drawnLines(pdf, page));
  const band = footerBand(pages[0], expected.length);
  return { pdf, pages, band, texts: band.map((line) => line.text.trim()), expected: expected.map((runs) => runs.map((run) => run.text).join("").trim()) };
}

describe("tenant quote footer in the PDF", () => {
  it("prints one, two, three and four configured lines exactly as typed, in order", async () => {
    const cases: [string, string[]][] = [
      ["Empresa Ejemplo S.L. · CIF B00000000", ["Empresa Ejemplo S.L. · CIF B00000000"]],
      ["<p>Empresa Ejemplo S.L.</p><p>Calle Mayor 123 · 28000 Madrid</p>", ["Empresa Ejemplo S.L.", "Calle Mayor 123 · 28000 Madrid"]],
      ["<p>Línea A<br>Línea B<br>Línea C</p>", ["Línea A", "Línea B", "Línea C"]],
      ["Primera línea\nSegunda línea\nTercera línea", ["Primera línea", "Segunda línea", "Tercera línea"]],
      ["<p><strong>Empresa Ejemplo S.L.</strong> · oficina</p><p></p><p>Tercera tras una línea en blanco</p><p><em>Cuarta</em> · <a href=\"https://example.org\">web</a></p>",
        ["Empresa Ejemplo S.L. · oficina", "", "Tercera tras una línea en blanco", "Cuarta · web"]],
    ];
    for (const [footer, lines] of cases) {
      const { band, texts } = await printedFooter(modelWithFooter(footer));
      assert.deepEqual(texts, lines, footer);
      // A blank line is an invisible space glyph; only visible text must sit inside the margins.
      for (const line of band.filter((drawn) => drawn.text.trim())) {
        assert.ok(line.x >= 39.9 && line.right <= PAGE_RIGHT_EDGE, `${line.text} inside the margins`);
      }
      // Same distance between every printed line, so a blank line keeps its height.
      const steps = band.slice(1).map((line, index) => +(band[index].y - line.y).toFixed(2));
      assert.ok(steps.every((step) => step === steps[0]), `even spacing ${steps}`);
    }
  });

  it("keeps a line that fits the page width on one line (it used to be cut at 60 characters)", async () => {
    const line = "Empresa Ejemplo S.L. · CIF B00000000 · Calle Mayor 123, bajo izquierda · 28000 Madrid (España)";
    assert.ok(line.length > 60);
    const { texts } = await printedFooter(modelWithFooter(`<p>${line}</p><p>Tel. 900 000 000 · info@example.org</p>`));
    assert.deepEqual(texts, [line, "Tel. 900 000 000 · info@example.org"]);
  });

  it("wraps long lines at the real width without cutting, overflowing or adding text", async () => {
    // Within the 400-character settings limit, so the saved footer is accepted.
    const first = "Primera línea larga: " + Array.from({ length: 14 }, (_, i) => `palabra${i + 1}`).join(" ");
    const second = "Segunda: https://example.org/" + "a".repeat(150);
    const model = modelWithFooter(`<p>${first}</p><p>${second}</p>`);
    assert.ok(model.footer.includes(second), "accepted by the settings validation");
    const { band, texts, expected } = await printedFooter(model);
    assert.ok(band.length > 2, "long lines wrap");
    assert.deepEqual(texts, expected, "react-pdf draws exactly the measured lines, it never wraps again");
    for (const line of band) assert.ok(line.right <= PAGE_RIGHT_EDGE, `${line.right} <= ${PAGE_RIGHT_EDGE}`);
    // Wrapped parts of the first line rejoin to the typed line.
    const firstParts = texts.slice(0, texts.findIndex((text) => text.startsWith("Segunda")));
    assert.equal(firstParts.join(" "), first);
    // Every character is printed once, in order: the URL is split, never clipped.
    assert.equal(texts.join("").replace(/\s/g, ""), (first + second).replace(/\s/g, ""));
  });

  it("prints nothing in the footer band for an empty footer", async () => {
    for (const footer of ["", "<p></p><p></p>", "   "]) {
      const { pages, band } = await printedFooter(modelWithFooter(footer));
      assert.deepEqual(band, [], JSON.stringify(footer));
      assert.deepEqual(pages[0].filter((line) => line.y < 58).map((line) => line.text), ["1 / 1"]);
    }
  });

  it("does not cap the number of lines in the renderer", async () => {
    const lines = ["Uno", "Dos", "Tres", "Cuatro", "Cinco", "Seis"];
    const { texts } = await printedFooter({ ...modelWithFooter(""), footer: lines.map((line) => `<p>${line}</p>`).join("") });
    assert.deepEqual(texts, lines);
  });

  it("drops the reference · currency line and keeps the header reference and page numbers on every page", async () => {
    const base = modelWithFooter("<p>Empresa Ejemplo S.L.</p><p>Calle Mayor 123 · 28000 Madrid</p>");
    const model = { ...base, items: Array.from({ length: 160 }, (_, index) => ({ ...base.items[index % 4], id: `${index}`, position: index + 1 })) };
    const { pdf, pages } = await printedFooter(model);
    const count = pdf.getPageCount();
    assert.ok(count > 2);
    pages.forEach((lines, index) => {
      const texts = lines.map((line) => line.text);
      assert.equal(texts.some((text) => text.includes(`${base.reference} · ${base.version.currency}`)), false, "no reference · currency line");
      assert.ok(texts.includes(base.reference), "header reference");
      assert.ok(texts.includes(`${index + 1} / ${count}`), "page number");
      assert.deepEqual(footerBand(lines, 2).map((line) => line.text), ["Empresa Ejemplo S.L.", "Calle Mayor 123 · 28000 Madrid"]);
    });
  });

  it("stays byte-identical across retries with wrapped lines", async () => {
    const model = modelWithFooter(`<p>${"Texto largo de prueba ".repeat(12)}</p>`);
    assert.deepEqual(await renderQuotePdf(model), await renderQuotePdf(model));
  });
});

describe("wrapFooterLine", () => {
  const perChar: FooterMeasure = (text) => text.length;
  const texts = (lines: { text: string }[][]) => lines.map((line) => line.map((run) => run.text).join(""));

  it("keeps a line that fits", () => {
    assert.deepEqual(texts(wrapFooterLine([{ text: "uno dos tres" }], 12, perChar)), ["uno dos tres"]);
  });
  it("breaks at spaces and drops only the space at the break", () => {
    assert.deepEqual(texts(wrapFooterLine([{ text: "uno dos tres cuatro" }], 8, perChar)), ["uno dos", "tres", "cuatro"]);
  });
  it("splits a word wider than the line instead of clipping it", () => {
    assert.deepEqual(texts(wrapFooterLine([{ text: "ab abcdefghij" }], 4, perChar)), ["ab", "abcd", "efgh", "ij"]);
  });
  it("keeps marks and links on both sides of a break", () => {
    const lines = wrapFooterLine([{ text: "uno " }, { text: "dos tres", bold: true, href: "https://example.org" }], 7, perChar);
    assert.deepEqual(lines, [[{ text: "uno " }, { text: "dos", bold: true, href: "https://example.org" }], [{ text: "tres", bold: true, href: "https://example.org" }]]);
  });
  it("keeps a blank line as one printed line", () => {
    assert.deepEqual(texts(wrapFooterLine([], 10, perChar)), [" "]);
  });
  it("never splits a surrogate pair", () => {
    assert.deepEqual(texts(wrapFooterLine([{ text: "a😀b" }], 2, perChar)), ["a", "😀", "b"]);
  });
});
