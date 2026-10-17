import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { strToU8 } from "fflate";

import { CLIENT_IMPORT_MAX_CELL_CHARS, CLIENT_IMPORT_MAX_COLUMNS, CLIENT_IMPORT_MAX_UNCOMPRESSED_BYTES } from "./limits";
import { ImportFileError, parseImportFile } from "./parse-file";
import { buildXlsx, xlsxParts, zipParts } from "./test-support";

const toBuffer = (bytes: Uint8Array) => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
const parse = (bytes: Uint8Array, name = "clientes.xlsx") => parseImportFile({ name, bytes: toBuffer(bytes) });
const rejects = (promise: Promise<unknown>, code: string) =>
  assert.rejects(promise, (error: unknown) => error instanceof ImportFileError && error.code === code);

const SHEET = "xl/worksheets/sheet1.xml";
const MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const baseParts = () => xlsxParts([{ name: "Clientes", rows: [["Nombre", "Email"], ["Ana", "ana@example.com"]] }]);
const sheetXml = (body: string) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="${MAIN}"><sheetData>${body}</sheetData></worksheet>`;

/** A worksheet that inflates to `bytes` bytes of padding (compresses to a few KB). */
function paddedSheet(bytes: number): Uint8Array {
  const head = strToU8(`<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="${MAIN}"><sheetData>`);
  const foot = strToU8(`</sheetData></worksheet>`);
  const out = new Uint8Array(bytes).fill(0x20);
  out.set(head, 0);
  out.set(foot, bytes - foot.length);
  return out;
}

/** Rewrites one field of the central-directory record of `name`. */
function patchCentral(zip: Uint8Array, name: string, field: "flags" | "method" | "size", value: number) {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const decoder = new TextDecoder();
  for (let offset = 0; offset + 46 <= zip.length; offset += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) continue;
    const nameLength = view.getUint16(offset + 28, true);
    if (decoder.decode(zip.subarray(offset + 46, offset + 46 + nameLength)) !== name) continue;
    if (field === "flags") view.setUint16(offset + 8, value, true);
    if (field === "method") view.setUint16(offset + 10, value, true);
    if (field === "size") view.setUint32(offset + 24, value, true);
    return zip;
  }
  throw new Error(`entry ${name} not found`);
}

describe("client import · hostile XLSX files", () => {
  const bomb = CLIENT_IMPORT_MAX_UNCOMPRESSED_BYTES + 4 * 1024 * 1024;

  it("refuses a zip bomb that declares its real size", async () => {
    const zip = zipParts({ ...baseParts(), [SHEET]: paddedSheet(bomb) });
    assert.ok(zip.length < 1024 * 1024, `bomb should be small, got ${zip.length}`);
    await rejects(parse(zip), "xlsx_too_large");
  });

  it("refuses a zip bomb that lies about its size", async () => {
    const zip = patchCentral(zipParts({ ...baseParts(), [SHEET]: paddedSheet(bomb) }), SHEET, "size", 1_000);
    await rejects(parse(zip), "xlsx_too_large");
  });

  it("refuses an entry whose real size differs from the declared one", async () => {
    const parts = baseParts();
    const zip = patchCentral(zipParts(parts), SHEET, "size", parts[SHEET].length + 5);
    await rejects(parse(zip), "xlsx_unsafe");
  });

  it("refuses DOCTYPE and entity declarations (entity expansion)", async () => {
    const laughs =
      `<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;&lol;">]>` +
      `<worksheet xmlns="${MAIN}"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>&lol2;</t></is></c></row></sheetData></worksheet>`;
    await rejects(parse(zipParts({ ...baseParts(), [SHEET]: strToU8(laughs) })), "xlsx_unsafe");
    // Far into the part, after several inflated chunks.
    const late = `${sheetXml(" ".repeat(300_000))}<!ENTITY x "y">`;
    await rejects(parse(zipParts({ ...baseParts(), [SHEET]: strToU8(late) })), "xlsx_unsafe");
  });

  it("refuses UTF-16 XML parts, which would hide those declarations", async () => {
    const xml = sheetXml("");
    const utf16 = new Uint8Array(2 + xml.length * 2);
    utf16.set([0xff, 0xfe]);
    for (let i = 0; i < xml.length; i += 1) utf16[2 + i * 2] = xml.charCodeAt(i);
    await rejects(parse(zipParts({ ...baseParts(), [SHEET]: utf16 })), "xlsx_unsafe");
  });

  it("refuses encrypted entries, unknown compression and ZIP64", async () => {
    await rejects(parse(patchCentral(zipParts(baseParts()), SHEET, "flags", 0x1)), "xlsx_unsafe");
    await rejects(parse(patchCentral(zipParts(baseParts()), SHEET, "method", 12)), "xlsx_unsafe");
    await rejects(parse(patchCentral(zipParts(baseParts()), SHEET, "size", 0xffffffff)), "xlsx_unsafe");
  });

  it("refuses archives with too many entries and more than 50 worksheets", async () => {
    const parts = baseParts();
    for (let i = 0; i < 1_001; i += 1) parts[`xl/extra/${i}.bin`] = new Uint8Array([i % 256]);
    await rejects(parse(zipParts(parts)), "xlsx_unsafe");
    const sheets = Array.from({ length: 51 }, (_, i) => ({ name: `Hoja ${i + 1}`, rows: [["Nombre"], [`C${i}`]] }));
    await rejects(parse(new Uint8Array(buildXlsx(sheets))), "too_many_sheets");
  });

  it("refuses corrupt compressed data", async () => {
    const zip = zipParts({ ...baseParts(), [SHEET]: strToU8(sheetXml("<row r=\"1\"></row>".repeat(2_000))) });
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    const marker = strToU8(SHEET);
    for (let offset = 0; offset + 30 < zip.length; offset += 1) {
      if (view.getUint32(offset, true) !== 0x04034b50) continue;
      const nameLength = view.getUint16(offset + 26, true);
      if (nameLength !== marker.length || !marker.every((byte, i) => zip[offset + 30 + i] === byte)) continue;
      const data = offset + 30 + nameLength + view.getUint16(offset + 28, true);
      zip.fill(0xff, data, data + 16);
      break;
    }
    await rejects(parse(zip), "invalid_xlsx");
  });

  it("reads formulas as their cached value, never the formula", async () => {
    const formula =
      `<row r="1"><c r="A1" t="inlineStr"><is><t>Nombre</t></is></c><c r="B1" t="inlineStr"><is><t>Web</t></is></c></row>` +
      `<row r="2"><c r="A2" t="inlineStr"><is><t>Ana</t></is></c><c r="B2" t="str"><f>HYPERLINK("http://x","ver")</f><v>ver</v></c></row>`;
    const parsed = await parse(zipParts({ ...baseParts(), [SHEET]: strToU8(sheetXml(formula)) }));
    assert.deepEqual(parsed.rows, [["Ana", "ver"]]);
  });
});

describe("client import · oversized rows and cells", () => {
  const csv = (text: string) => new TextEncoder().encode(text);

  it(`accepts ${CLIENT_IMPORT_MAX_COLUMNS} columns and refuses more, in CSV and XLSX`, async () => {
    const headers = (count: number) => Array.from({ length: count }, (_, i) => `Columna ${i + 1}`);
    const ok = await parse(csv(`${headers(CLIENT_IMPORT_MAX_COLUMNS).join(";")}\n${"x;".repeat(CLIENT_IMPORT_MAX_COLUMNS - 1)}x\n`), "a.csv");
    assert.equal(ok.headers.length, CLIENT_IMPORT_MAX_COLUMNS);
    await rejects(parse(csv(`${headers(CLIENT_IMPORT_MAX_COLUMNS + 1).join(";")}\nx\n`), "a.csv"), "too_many_columns");
    const wide = buildXlsx([{ name: "Clientes", rows: [headers(CLIENT_IMPORT_MAX_COLUMNS + 1), ["Ana"]] }]);
    await rejects(parse(new Uint8Array(wide)), "too_many_columns");
  });

  it(`accepts a ${CLIENT_IMPORT_MAX_CELL_CHARS}-character cell and refuses a longer one, with its line`, async () => {
    const ok = await parse(csv(`Nombre;Notas\nAna;${"n".repeat(CLIENT_IMPORT_MAX_CELL_CHARS)}\n`), "a.csv");
    assert.equal(ok.rows[0][1].length, CLIENT_IMPORT_MAX_CELL_CHARS);
    await assert.rejects(
      parse(csv(`Nombre;Notas\nAna;x\nBea;${"n".repeat(CLIENT_IMPORT_MAX_CELL_CHARS + 1)}\n`), "a.csv"),
      (error: unknown) => error instanceof ImportFileError && error.code === "cell_too_long" && error.line === 3,
    );
  });
});
