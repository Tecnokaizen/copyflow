import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { parseKioskOrderPayload } from "@/lib/kiosk/payload";
import { richTextLines } from "./lines";
import {
  TEXT_ALIGNS,
  TEXT_COLORS,
  TEXT_SIZES,
  paragraphStyleAttributes,
  textAlignOf,
  textColorOf,
  textSizeOf,
  textStyleAttributes,
} from "./text-styles";

const root = path.resolve(import.meta.dirname, "../..");
const read = (relative: string) => readFileSync(path.join(root, relative), "utf8");

describe("text style vocabulary", () => {
  it("accepts only the exact tokens", () => {
    assert.equal(textSizeOf("large"), "large");
    assert.equal(textColorOf("red"), "red");
    for (const value of ["Large", " large", "16px", "", null, undefined, 1, "normal"]) {
      assert.equal(textSizeOf(value), null, String(value));
    }
    for (const value of ["Red", "red ", "#ff0000", "rgb(255,0,0)", "", null, "inherit"]) {
      assert.equal(textColorOf(value), null, String(value));
    }
    assert.equal(textAlignOf("justify"), "justify");
    for (const value of ["left", "Center", " right", "start", "end", "center;color:red", "", null]) {
      assert.equal(textAlignOf(value), null, String(value));
    }
  });

  it("keeps only valid token attributes, size first", () => {
    assert.deepEqual(
      textStyleAttributes({ style: "color:red", "data-text-color": "blue", "data-text-size": "small", class: "x" }),
      { "data-text-size": "small", "data-text-color": "blue" }
    );
    assert.deepEqual(textStyleAttributes({ "data-text-color": "pink" }), {});
    assert.deepEqual(paragraphStyleAttributes({ "data-text-align": "center", style: "text-align:right", class: "x" }), { "data-text-align": "center" });
    assert.deepEqual(paragraphStyleAttributes({ "data-text-align": "left" }), {});
  });

  it("offers a limited palette with Spanish labels", () => {
    assert.deepEqual(TEXT_SIZES.map((size) => size.label), ["Pequeño", "Grande", "Muy grande"]);
    assert.deepEqual(TEXT_COLORS.map((color) => color.label), ["Rojo", "Naranja", "Verde", "Azul", "Morado"]);
    assert.deepEqual(TEXT_ALIGNS.map((align) => align.label), ["Centrada", "Derecha", "Justificada"]);
  });
});

// WCAG relative luminance from an `H S% L%` token.
function luminance(token: string) {
  const [h, s, l] = token.replace(/%/g, "").trim().split(/\s+/).map(Number);
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const channel = (n: number) => {
    const k = (n + h / 30) % 12;
    const value = l / 100 - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
    const rounded = Math.round(value * 255) / 255;
    return rounded <= 0.03928 ? rounded / 12.92 : ((rounded + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(8) + 0.0722 * channel(4);
}

function contrast(a: string, b: string) {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}

/** Custom properties declared in every top-level `selector { … }` block. */
function tokens(css: string, selector: string) {
  const result: Record<string, string> = {};
  let start = css.indexOf(`${selector} {`);
  assert.ok(start >= 0, `missing ${selector} block`);
  while (start >= 0) {
    const block = css.slice(start, css.indexOf("}", start));
    for (const match of block.matchAll(/--([\w-]+):\s*([^;]+);/g)) result[match[1]] = match[2].trim();
    start = css.indexOf(`${selector} {`, start + 1);
  }
  return result;
}

describe("text style colors are readable in light, dark and print", () => {
  const globals = read("app/globals.css");
  const print = read("components/print/print.css");
  const light = tokens(globals, ":root");
  const dark = tokens(globals, ".dark");
  const paper = tokens(print, ".print-document");

  it("has a CSS rule and theme tokens for every size and color", () => {
    for (const { value } of TEXT_SIZES) {
      assert.match(globals, new RegExp(`\\[data-text-size="${value}"\\] \\{\\s*font-size: [\\d.]+em;`));
    }
    for (const { value } of TEXT_ALIGNS) {
      assert.match(globals, new RegExp(`\\[data-text-align="${value}"\\] \\{\\s*text-align: ${value};`));
    }
    for (const { value } of TEXT_COLORS) {
      assert.match(globals, new RegExp(`\\[data-text-color="${value}"\\] \\{\\s*color: hsl\\(var\\(--gc-text-${value}\\)\\);`));
      assert.ok(light[`gc-text-${value}`] && dark[`gc-text-${value}`], value);
      assert.equal(paper[`gc-text-${value}`], light[`gc-text-${value}`], `print pins the light ${value}`);
    }
  });

  it("meets WCAG AA (4.5:1) on every surface where the text is shown or edited", () => {
    for (const { value } of TEXT_COLORS) {
      const name = `gc-text-${value}`;
      for (const surface of ["background", "card", "popover", "accent", "muted"]) {
        assert.ok(contrast(light[name], light[surface]) >= 4.5, `light ${value} on ${surface}: ${contrast(light[name], light[surface]).toFixed(2)}`);
        assert.ok(contrast(dark[name], dark[surface]) >= 4.5, `dark ${value} on ${surface}: ${contrast(dark[name], dark[surface]).toFixed(2)}`);
      }
      assert.ok(contrast(paper[name], "0 0% 100%") >= 4.5, `print ${value} on white`);
    }
  });
});

describe("text styles stay out of the fields that do not opt in", () => {
  it("only order instructions, notes and their print opt in", () => {
    const allowed = new Set([
      "components/orders/create-order-form.tsx",
      "components/orders/detail/order-production.tsx",
      "components/orders/detail/order-notes.tsx",
      "components/orders/detail/order-quick-actions.tsx",
      "components/print/order-print-document.tsx",
      // Shared components that define the prop.
      "components/rich-text/rich-text-editor.tsx",
      "components/rich-text/rich-text-content.tsx",
      "components/print/print-frame.tsx",
    ]);
    const found: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(path.join(root, dir))) {
        const relative = path.join(dir, name);
        if (statSync(path.join(root, relative)).isDirectory()) walk(relative);
        else if (relative.endsWith(".tsx") && /\btextStyles\b/.test(read(relative))) found.push(relative);
      }
    };
    walk("app");
    walk("components");
    assert.deepEqual(found.filter((file) => !allowed.has(file)), []);
    for (const file of ["components/print/quote-print-document.tsx", "components/settings/organization-settings.tsx", "components/kiosk/kiosk-order-form.tsx"]) {
      assert.equal(/\btextStyles\b/.test(read(file)), false, file);
    }
  });

  it("the quote footer lines ignore order tokens", () => {
    assert.deepEqual(
      richTextLines('<p data-text-align="center"><span data-text-size="xlarge" data-text-color="red">Empresa</span> · Tel.</p><p data-text-align="right">CIF</p>').map((line) => line.map((run) => run.text).join("")),
      ["Empresa · Tel.", "CIF"]
    );
  });

  it("the public kiosk keeps the basic vocabulary", () => {
    const parsed = parseKioskOrderPayload({
      submission_id: "11111111-1111-4111-8111-111111111111",
      service_id: "22222222-2222-4222-8222-222222222222",
      contact: { name: "Cliente", email: "cliente@example.com" },
      description: '<p data-text-align="center"><span data-text-color="red" data-text-size="xlarge">Urgente</span> 100 copias</p>',
    });
    assert.equal(parsed.ok, true);
    assert.equal(JSON.stringify(parsed).includes("data-text-"), false);
  });
});
