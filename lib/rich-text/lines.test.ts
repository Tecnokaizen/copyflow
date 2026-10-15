import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeRichText } from "./html";
import { richTextLines, richTextLineStats } from "./lines";
import { parseQuoteFooter, quoteFooterFromBranding } from "@/lib/tenant/branding";

const plain = (value: string) => richTextLines(value).map((line) => line.map((run) => run.text).join(""));

describe("quote footer rich text", () => {
  it("keeps inline spaces, nested marks and entities without interpreting escaped tags", () => {
    const lines = richTextLines('<p>A <strong><em>B &amp; C</em></strong> <u>D</u> <s>E</s> &lt;b&gt; &#241; &amp;lt;</p>');
    assert.deepEqual(plain('<p>A <strong>B</strong> C</p>'), ["A B C"]);
    assert.equal(lines[0][1].bold, true);
    assert.equal(lines[0][1].italic, true);
    assert.equal(lines[0].find((run) => run.text === "D")?.underline, true);
    assert.equal(lines[0].find((run) => run.text === "E")?.strike, true);
    assert.equal(lines[0].map((run) => run.text).join(""), "A B & C D E <b> ñ &lt;");
  });
  it("counts paragraphs, hard breaks, blank lines and lists as rendered content", () => {
    assert.deepEqual(plain("Uno\n\nTres"), ["Uno", "", "Tres"]);
    assert.deepEqual(plain("<p>Uno<br>Dos</p><p><br></p><p>Tres</p>"), ["Uno", "Dos", "", "Tres"]);
    assert.deepEqual(plain("<ul><li><p>Uno</p></li><li><p>Dos</p></li></ul><ol><li><p>Tres</p></li></ol>"), ["• Uno", "• Dos", "1. Tres"]);
    assert.equal(parseQuoteFooter("<p>1<br><br><br><br>5</p>").ok, false);
    assert.equal(parseQuoteFooter("<p>1</p><p></p><p></p><p></p><p>5</p>").ok, false);
    assert.equal(parseQuoteFooter("<ul>" + "<li><p>x</p></li>".repeat(5) + "</ul>").ok, false);
  });
  it("limits visible text separately from markup and never truncates excess", () => {
    const value = `<p><strong>${"x".repeat(400)}</strong></p>`;
    assert.deepEqual(richTextLineStats(value), { chars: 400, lines: 1 });
    const parsed = parseQuoteFooter(value);
    assert.equal(parsed.ok, true);
    if (parsed.ok) assert.equal(parsed.value, value);
    assert.equal(parseQuoteFooter(`<p>${"x".repeat(401)}</p>`).ok, false);
    assert.equal(parseQuoteFooter("<strong>".repeat(1000) + "x" + "</strong>".repeat(1000)).ok, false);
    assert.deepEqual(parseQuoteFooter("<p><br></p>"), { ok: true, value: null });
    assert.equal(quoteFooterFromBranding({ quote_footer: "<p>1<br>2<br>3<br>4<br>5</p>" }), "");
  });
  it("uses the shared sanitizer and stable safe links on repeated reads and saves", () => {
    const unsafe = '<p style="color:red" onclick="evil()"><b>Empresa</b><script>evil()</script><img src="x"><a href="javascript:evil()">Mal</a><a href="https://example.org/?a=1&amp;b=2">Web</a></p>';
    const parsed = parseQuoteFooter(unsafe);
    assert.equal(parsed.ok, true);
    if (!parsed.ok || !parsed.value) return;
    assert.doesNotMatch(parsed.value, /script|onclick|style=|img|javascript:/);
    assert.match(parsed.value, /<strong>Empresa<\/strong>/);
    assert.deepEqual(parseQuoteFooter(parsed.value), parsed);
    assert.equal(normalizeRichText(normalizeRichText(parsed.value)), parsed.value);
    const runs = richTextLines(parsed.value).flat();
    assert.equal(runs.find((run) => run.text === "Mal")?.href, undefined);
    assert.equal(runs.find((run) => run.text === "Web")?.href, "https://example.org/?a=1&b=2");
  });
});
