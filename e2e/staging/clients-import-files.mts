// Synthetic QA files for clients-import-qa.mts: 100 CSV (Windows-1252, ;),
// 1 000 XLSX, 10 000 CSV (UTF-8 BOM, ,), a 1 200-row CSV for the interrupted
// upload and two hostile XLSX (a zip bomb and an entity declaration).
// The review file of step 12 is built by the QA script from the tenant's clients.
// OUT=<dir> SEED=<n> SUFFIX=<s> npx tsx e2e/staging/clients-import-files.mts
import { writeFileSync } from "node:fs";
import { strToU8 } from "fflate";
import { generateClientFixture } from "../../scripts/imports/client-fixtures";
import { parseImportFile } from "../../lib/imports/clients/parse-file";
import { buildXlsx, xlsxParts, zipParts } from "../../lib/imports/clients/test-support";
const out = process.env.OUT!;
const f100 = generateClientFixture({ rows: 100, seed: Number(process.env.SEED ?? 101), delimiter: ";", encoding: "windows-1252" });
writeFileSync(`${out}/clientes-100${process.env.SUFFIX ?? ""}.csv`, f100.bytes);
const f1000 = generateClientFixture({ rows: 1000, seed: Number(process.env.SEED ?? 101) + 101, delimiter: ";", encoding: "utf8" });
const parsed = await parseImportFile({ name: "x.csv", bytes: f1000.bytes.buffer.slice(0) as ArrayBuffer });
writeFileSync(`${out}/clientes-1000${process.env.SUFFIX ?? ""}.xlsx`, new Uint8Array(buildXlsx([{ name: "Clientes", rows: [parsed.headers, ...parsed.rows] }])));
const f10000 = generateClientFixture({ rows: 10000, seed: Number(process.env.SEED ?? 101) + 202, delimiter: ",", encoding: "utf8-bom" });
writeFileSync(`${out}/clientes-10000${process.env.SUFFIX ?? ""}.csv`, f10000.bytes);
const fPartial = generateClientFixture({ rows: 1200, seed: Number(process.env.SEED ?? 101) + 303, delimiter: ";", encoding: "utf8" });
writeFileSync(`${out}/clientes-incompleta${process.env.SUFFIX ?? ""}.csv`, fPartial.bytes);
const MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const SHEET = "xl/worksheets/sheet1.xml";
const hostileBase = () => xlsxParts([{ name: "Clientes", rows: [["Nombre", "Email"], ["Ana", "ana@example.com"]] }]);
// 70 MB of padding once inflated (the limit is 64 MB); a few hundred KB on disk.
const padding = new Uint8Array(70 * 1024 * 1024).fill(0x20);
padding.set(strToU8(`<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="${MAIN}"><sheetData>`), 0);
const foot = strToU8("</sheetData></worksheet>");
padding.set(foot, padding.length - foot.length);
writeFileSync(`${out}/xlsx-bomba${process.env.SUFFIX ?? ""}.xlsx`, zipParts({ ...hostileBase(), [SHEET]: padding }));
writeFileSync(`${out}/xlsx-entidades${process.env.SUFFIX ?? ""}.xlsx`, zipParts({ ...hostileBase(), [SHEET]: strToU8(
  `<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "aaaa">]><worksheet xmlns="${MAIN}"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>&a;</t></is></c></row></sheetData></worksheet>`,
) }));
console.log("files written");
