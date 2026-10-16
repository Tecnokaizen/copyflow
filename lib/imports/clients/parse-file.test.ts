import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";

import { encodeFixture, generateClientFixture } from "../../../scripts/imports/client-fixtures";
import { decodeText } from "./encoding";
import { ImportFileError, parseImportFile } from "./parse-file";
import { buildXlsx } from "./test-support";

const toBuffer = (bytes: Uint8Array) => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
const rejects = (promise: Promise<unknown>, code: string) =>
  assert.rejects(promise, (error: unknown) => error instanceof ImportFileError && error.code === code);

describe("client import · encodings", () => {
  it("detects UTF-8, UTF-8 with BOM, UTF-16 LE and Windows-1252", () => {
    const text = "Nombre;Población\nBegoña;Logroño 50 €\n";
    assert.deepEqual(decodeText(new TextEncoder().encode(text)), { text, encoding: "utf-8" });
    assert.deepEqual(decodeText(encodeFixture(text, "utf8-bom")), { text, encoding: "utf-8-bom" });
    assert.deepEqual(decodeText(encodeFixture(text, "windows-1252")), { text, encoding: "windows-1252" });
    const utf16 = new Uint8Array([0xff, 0xfe, ...Array.from(text).flatMap((ch) => [ch.charCodeAt(0) & 0xff, ch.charCodeAt(0) >> 8])]);
    assert.deepEqual(decodeText(utf16), { text, encoding: "utf-16le" });
  });
});

describe("client import · CSV files", () => {
  for (const [delimiter, encoding] of [[";", "windows-1252"], [",", "utf8-bom"], ["\t", "utf8"]] as const) {
    it(`reads a generated fixture (${JSON.stringify(delimiter)}, ${encoding}) row for row`, async () => {
      const fixture = generateClientFixture({ rows: 300, seed: 9, delimiter, encoding });
      const parsed = await parseImportFile({ name: "clientes.csv", bytes: toBuffer(fixture.bytes) });
      assert.equal(parsed.kind, "csv");
      assert.equal(parsed.delimiter, delimiter);
      assert.deepEqual(parsed.headers, fixture.manifest.columns);
      assert.equal(parsed.rows.length, 300);
      assert.ok(parsed.rows.some((row) => row[11].includes("\n") && row[11].includes("€")), "multiline notes with € survive");
      assert.ok(parsed.rows.some((row) => row[11].startsWith("=HYPERLINK")), "formulas stay plain text");
      assert.equal(parsed.fileSha256, createHash("sha256").update(fixture.bytes).digest("hex"));
    });
  }

  it("keeps leading zeros and long numbers as text", async () => {
    const csv = "Código;Teléfono;NIF\n00042;0034600111222;00123456Z\n";
    const parsed = await parseImportFile({ name: "c.csv", bytes: toBuffer(new TextEncoder().encode(csv)) });
    assert.deepEqual(parsed.rows, [["00042", "0034600111222", "00123456Z"]]);
  });

  it("refuses a file with an unterminated quote instead of truncating it", async () => {
    const csv = 'Nombre;Notas\nAna;ok\nLuis;=HYPERLINK("http://x";"y")\nEva;ok\nPablo;ok\n';
    await assert.rejects(
      parseImportFile({ name: "c.csv", bytes: toBuffer(new TextEncoder().encode(csv)) }),
      (error: unknown) => error instanceof ImportFileError && error.code === "csv_unterminated_quote" && error.line === 3,
    );
    const quoted = 'Nombre;Notas\nAna;ok\nLuis;"=HYPERLINK(""http://x"";""y"")"\nEva;ok\n';
    const parsed = await parseImportFile({ name: "c.csv", bytes: toBuffer(new TextEncoder().encode(quoted)) });
    assert.deepEqual(parsed.rows.map((row) => row[0]), ["Ana", "Luis", "Eva"]);
    assert.equal(parsed.rows[1][1], '=HYPERLINK("http://x";"y")');
  });

  it("skips leading empty lines, pads short rows and drops trailing empty rows", async () => {
    const csv = "\n\nNombre;Email;;\nAna;ana@example.com\n;;;\n";
    const parsed = await parseImportFile({ name: "c.csv", bytes: toBuffer(new TextEncoder().encode(csv)) });
    assert.deepEqual(parsed.headers, ["Nombre", "Email"]);
    assert.deepEqual(parsed.rows, [["Ana", "ana@example.com"]]);
  });
});

describe("client import · XLSX files", () => {
  it("reads text, numbers as exact text and dates as YYYY-MM-DD", async () => {
    const bytes = buildXlsx([
      {
        name: "Clientes",
        rows: [
          ["Nombre", "Teléfono", "Alta", "Notas"],
          ["Íñigo Peña", 600111222, { date: new Date(Date.UTC(2026, 9, 16)) }, "=SUMA(A1)"],
          ["Ana", 34600333444, null, "Línea 1\nLínea 2"],
        ],
      },
      { name: "Otra", rows: [["Nombre"], ["Hoja dos"]] },
    ]);
    const parsed = await parseImportFile({ name: "export.xlsx", bytes });
    assert.equal(parsed.kind, "xlsx");
    assert.deepEqual(parsed.sheetNames, ["Clientes", "Otra"]);
    assert.equal(parsed.sheet, "Clientes");
    assert.deepEqual(parsed.headers, ["Nombre", "Teléfono", "Alta", "Notas"]);
    assert.deepEqual(parsed.rows[0], ["Íñigo Peña", "600111222", "2026-10-16", "=SUMA(A1)"]);
    assert.deepEqual(parsed.rows[1], ["Ana", "34600333444", "", "Línea 1\nLínea 2"]);

    const second = await parseImportFile({ name: "export.xlsx", bytes }, { sheet: "Otra" });
    assert.deepEqual(second.rows, [["Hoja dos"]]);
    await rejects(parseImportFile({ name: "export.xlsx", bytes }, { sheet: "No existe" }), "sheet_not_found");
  });

  it("rejects corrupt XLSX and legacy XLS files", async () => {
    await rejects(parseImportFile({ name: "x.xlsx", bytes: toBuffer(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3])) }), "invalid_xlsx");
    await rejects(parseImportFile({ name: "x.xls", bytes: toBuffer(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0, 0])) }), "xls_not_supported");
    await rejects(parseImportFile({ name: "x.pdf", bytes: toBuffer(new TextEncoder().encode("%PDF")) }), "unsupported_file");
  });
});

describe("client import · file limits", () => {
  it("rejects empty, oversized and over-long files", async () => {
    await rejects(parseImportFile({ name: "c.csv", bytes: new ArrayBuffer(0) }), "empty_file");
    await rejects(parseImportFile({ name: "c.csv", bytes: new ArrayBuffer(5 * 1024 * 1024 + 1) }), "file_too_large");
    await rejects(parseImportFile({ name: "c.csv", bytes: toBuffer(new TextEncoder().encode("Nombre\n")) }), "no_rows");
    const tooMany = generateClientFixture({ rows: 10_001, seed: 1 });
    await rejects(parseImportFile({ name: "c.csv", bytes: toBuffer(tooMany.bytes) }), "too_many_rows");
    const maximum = generateClientFixture({ rows: 10_000, seed: 1 });
    assert.equal((await parseImportFile({ name: "c.csv", bytes: toBuffer(maximum.bytes) })).rows.length, 10_000);
  });
});
