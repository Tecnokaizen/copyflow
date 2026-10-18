import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { encodeFixture, generateClientFixture } from "./client-fixtures";

/** Minimal RFC 4180 reader, only to prove the generator's quoting round-trips. */
function parseCsv(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === delimiter) {
      row.push(field);
      field = "";
    } else if (char === "\r" && text[i + 1] === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i += 1;
    } else {
      field += char;
    }
  }
  return rows;
}

const normalizeEmail = (value: string) => value.toLowerCase().replace(/\s+/g, "");
const digits = (value: string) => value.replace(/\D/g, "");

describe("client import fixtures", () => {
  it("is deterministic for a seed", () => {
    const a = generateClientFixture({ rows: 300, seed: 7 });
    const b = generateClientFixture({ rows: 300, seed: 7 });
    const c = generateClientFixture({ rows: 300, seed: 8 });
    assert.deepEqual(a.bytes, b.bytes);
    assert.notDeepEqual(a.bytes, c.bytes);
  });

  for (const delimiter of [";", ",", "\t"] as const) {
    it(`round-trips every row with delimiter ${JSON.stringify(delimiter)}`, () => {
      const { text, manifest } = generateClientFixture({ rows: 250, seed: 3, delimiter });
      const [header, ...rows] = parseCsv(text, delimiter);
      assert.deepEqual(header, manifest.columns);
      assert.equal(rows.length, 250);
      assert.ok(rows.every((row) => row.length === manifest.columns.length));
      assert.ok(rows.some((row) => row[11].includes("\n")), "multiline notes survive quoting");
    });
  }

  it("matches the manifest classification", () => {
    const { text, manifest } = generateClientFixture({ rows: 1000, seed: 42 });
    const [, ...rows] = parseCsv(text, ";");
    const seenEmails = new Map<string, number>();
    const seenPhones = new Map<string, number>();

    rows.forEach((row, index) => {
      const kind = manifest.kinds[index];
      const [, name, , , , email, phone] = row;
      if (kind === "missing_name") assert.equal(name, "");
      else assert.notEqual(name, "");
      if (kind === "invalid_email") assert.equal(email.includes("@"), false);
      if (kind === "in_file_duplicate") assert.ok(seenEmails.has(normalizeEmail(email)), `row ${index + 1} duplicates an earlier email`);
      if (kind === "phone_prefix_duplicate") {
        assert.ok(phone.startsWith("+34 "));
        assert.ok(seenPhones.has(digits(phone).slice(2)), `row ${index + 1} repeats an earlier phone with +34`);
      }
      if (kind === "valid") assert.equal(seenEmails.has(normalizeEmail(email)), false);
      seenEmails.set(normalizeEmail(email), index);
      seenPhones.set(digits(phone), index);
    });

    const total = Object.entries(manifest.counts)
      .filter(([key]) => key !== "formula_cells" && key !== "multiline_notes")
      .reduce((sum, [, value]) => sum + value, 0);
    assert.equal(total, 1000);
    assert.equal(rows.filter((row) => row[11].startsWith("=")).length, manifest.counts.formula_cells);
    assert.ok(manifest.counts.in_file_duplicate > 0 && manifest.counts.phone_prefix_duplicate > 0);
    assert.ok(manifest.counts.missing_name > 0 && manifest.counts.invalid_email > 0);
  });

  it("uses only fictitious contact data", () => {
    const { text } = generateClientFixture({ rows: 500, seed: 11 });
    const emails = text.match(/[^\s;"]+@[^\s;"]+/g) ?? [];
    assert.ok(emails.length > 0);
    assert.ok(emails.every((email) => /@example\.(com|org|net)$/i.test(email.trim())));
  });

  it("encodes UTF-8 with BOM and Windows-1252", () => {
    const sample = "Begoña · 50 €";
    assert.deepEqual([...encodeFixture(sample, "utf8-bom").slice(0, 3)], [0xef, 0xbb, 0xbf]);
    const cp1252 = encodeFixture(sample, "windows-1252");
    assert.equal(cp1252.length, sample.length);
    assert.equal(cp1252[4], 0xf1);
    assert.equal(cp1252[cp1252.length - 1], 0x80);
    assert.throws(() => encodeFixture("emoji 📄", "windows-1252"), /Windows-1252/);
    const { bytes } = generateClientFixture({ rows: 200, seed: 5, encoding: "windows-1252" });
    assert.equal(new TextDecoder("windows-1252").decode(bytes), generateClientFixture({ rows: 200, seed: 5 }).text);
  });

  it("supports English headers and rejects invalid sizes", () => {
    assert.equal(generateClientFixture({ rows: 1, seed: 1, header: "en" }).manifest.columns[1], "Name");
    assert.throws(() => generateClientFixture({ rows: 0, seed: 1 }), /rows/);
  });
});
