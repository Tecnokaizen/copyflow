import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const root = path.join(import.meta.dirname, "../..");

describe("counter mobile polish (source)", () => {
  it("uses icon-only list/grid controls with accessible labels", () => {
    const source = readFileSync(
      path.join(root, "app/counter/page.tsx"),
      "utf8"
    );
    assert.match(source, /aria-label="Vista de lista"/);
    assert.match(source, /aria-label="Vista de rejilla"/);
    assert.match(source, /aria-pressed=\{view === "list"\}/);
    assert.match(source, /aria-pressed=\{view === "grid"\}/);
    assert.match(source, /<List /);
    assert.match(source, /<LayoutGrid /);
    assert.doesNotMatch(
      source,
      />\s*Lista\s*</
    );
    assert.doesNotMatch(
      source,
      />\s*Rejilla\s*</
    );
  });

  it("keeps Todos / Mis pedidos as a segmented control without chip borders", () => {
    const source = readFileSync(
      path.join(root, "app/counter/page.tsx"),
      "utf8"
    );
    assert.match(source, /aria-label="Ámbito de pedidos"/);
    assert.match(source, /aria-pressed=\{!mine\}/);
    assert.match(source, /aria-pressed=\{mine\}/);
    assert.doesNotMatch(
      source,
      /Ámbito de pedidos[\s\S]*?gc-chip/
    );
  });
});

describe("PageHeader responsive typography (source)", () => {
  it("uses compact mobile title and description scales", () => {
    const source = readFileSync(
      path.join(root, "components/gestcopy/page-header.tsx"),
      "utf8"
    );
    assert.match(source, /text-2xl/);
    assert.match(source, /sm:text-3xl/);
    assert.match(source, /text-sm/);
    assert.match(source, /sm:text-base/);
  });
});
