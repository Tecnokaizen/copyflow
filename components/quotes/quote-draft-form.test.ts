import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

// The form imports CSS (react-day-picker), which node:test cannot load, so this file
// pins the source contract. Rendering and behavior (limit, read-only, focus, mobile and
// desktop) are exercised against the real component in scripts/quotes-draft-ui-smoke.mjs.
const source = readFileSync(new URL("./quote-draft-form.tsx", import.meta.url), "utf8");
const button = source.slice(source.indexOf('aria-label={`Duplicar partida'), source.indexOf('aria-label={`Eliminar partida'));
const duplicate = source.slice(source.indexOf("function duplicate("), source.indexOf("return <form"));

describe("quote draft form: duplicate line", () => {
  it("builds the copy through the pure editor helper with a fresh random key", () => {
    assert.match(duplicate, /const key = crypto\.randomUUID\(\)/);
    assert.match(duplicate, /duplicateEditorItem\(values\.items, index, key\)/);
    assert.match(duplicate, /if \(items === values\.items\) return;/);
  });

  it("changes state only through onChange: explicit save is untouched and nothing is sent or calculated", () => {
    assert.match(duplicate, /onChange\(\{ \.\.\.values, items \}\)/);
    assert.doesNotMatch(duplicate, /onSave|onPrepare|fetch\(|Number\(|parseFloat|subtotal|tax_amount|total/);
    assert.match(source, /onSubmit=\{\(event\) => \{ event\.preventDefault\(\); onSave\(\); \}\}/);
  });

  it("lives inside the editable-only action group, next to the existing line actions", () => {
    const group = source.slice(source.indexOf("{!readonly ? <div className=\"flex gap-1\">"), source.indexOf("</div> : null}\n            </div>\n            <div className=\"grid gap-3 sm:grid-cols-2\">"));
    assert.ok(group.includes("Duplicar partida"), "inside the !readonly group");
    const order = ["Subir partida", "Bajar partida", "Duplicar partida", "Eliminar partida"].map((label) => group.indexOf(label));
    assert.ok(order.every((position) => position > -1));
    assert.deepEqual([...order].sort((a, b) => a - b), order);
  });

  it("is disabled while busy or blocked and at the 500-line limit, with the same touch target", () => {
    assert.match(button, /disabled=\{busy \|\| blocked \|\| values\.items\.length >= MAX_EDITOR_ITEMS\}/);
    assert.match(button, /min-h-11/);
    assert.match(button, /type="button"/);
    assert.match(button, /title=\{values\.items\.length >= MAX_EDITOR_ITEMS \? `Máximo de \$\{MAX_EDITOR_ITEMS\} partidas` : "Duplicar partida"\}/);
    assert.match(button, /<Copy size=\{16\} aria-hidden="true" \/><span className="hidden sm:inline">Duplicar<\/span>/);
  });

  it("uses one shared limit for Añadir línea and Duplicar", () => {
    assert.match(source, /values\.items\.length >= MAX_EDITOR_ITEMS\} onClick=\{\(\) => onChange\(\{ \.\.\.values, items: \[\.\.\.values\.items, emptyEditorItem/);
    assert.doesNotMatch(source, />= 500|> 500/);
  });

  it("moves focus to the copy and announces it politely", () => {
    assert.match(source, /querySelector<HTMLInputElement>\("input"\)\?\.focus\(\)/);
    assert.match(source, /data-item-key=\{item\.key\}/);
    assert.match(source, /role="status" className="sr-only"/);
    assert.match(source, /Partida \$\{index \+ 1\} duplicada\. La copia es la partida \$\{index \+ 2\}\./);
  });

  it("does not introduce alternatives or touch commercial logic", () => {
    assert.doesNotMatch(source, /is_optional|alternativ|option_group/i);
  });
});
