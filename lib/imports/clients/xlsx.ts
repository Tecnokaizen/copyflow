import readXlsxFile from "read-excel-file/universal";

import { assertSafeXlsx } from "./xlsx-guard";

export type XlsxSheet = { name: string; rows: string[][] };

function cellToText(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? "" : value.toISOString().slice(0, 10);
  }
  if (typeof value === "boolean") {
    return value ? "TRUE" : "FALSE";
  }
  return String(value);
}

/**
 * Reads every sheet of an .xlsx file as text. Numbers keep the exact text
 * stored in the file (parseNumber returns it untouched), so phones and tax ids
 * never become floats; dates become YYYY-MM-DD. Formulas are not evaluated:
 * only their cached values are read.
 */
export async function readXlsxSheets(input: ArrayBuffer): Promise<XlsxSheet[]> {
  // Size, structure and XML checks before the reader expands anything.
  assertSafeXlsx(new Uint8Array(input));
  const sheets = await readXlsxFile<string>(input, { parseNumber: (value) => value });
  return sheets.map((sheet) => ({
    name: sheet.sheet,
    rows: sheet.data.map((row) => row.map(cellToText)),
  }));
}
