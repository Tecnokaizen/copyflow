// Synthetic QA files for clients-import-qa.mts: 100 CSV (Windows-1252, ;),
// 1 000 XLSX, 10 000 CSV (UTF-8 BOM, ,) and a 1 200-row CSV for the interrupted
// upload. OUT=<dir> SEED=<n> SUFFIX=<s> npx tsx e2e/staging/clients-import-files.mts
import { writeFileSync } from "node:fs";
import { generateClientFixture } from "../../scripts/imports/client-fixtures";
import { parseImportFile } from "../../lib/imports/clients/parse-file";
import { buildXlsx } from "../../lib/imports/clients/test-support";
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
console.log("files written");
