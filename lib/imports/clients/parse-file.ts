import { parseCsvText, type CsvDelimiter } from "./csv";
import { decodeText, type DetectedEncoding } from "./encoding";
import {
  CLIENT_IMPORT_MAX_CELL_CHARS,
  CLIENT_IMPORT_MAX_COLUMNS,
  CLIENT_IMPORT_MAX_FILE_BYTES,
  CLIENT_IMPORT_MAX_ROWS,
} from "./limits";
import { ImportFileError } from "./errors";
import { readXlsxSheets } from "./xlsx";

export { IMPORT_FILE_ERROR_LABELS, ImportFileError, importFileErrorMessage, type ImportFileErrorCode } from "./errors";

export type ParsedImportFile = {
  fileName: string;
  fileSize: number;
  fileSha256: string;
  kind: "csv" | "xlsx";
  encoding: DetectedEncoding | null;
  delimiter: CsvDelimiter | null;
  sheetNames: string[];
  sheet: string | null;
  headers: string[];
  /** Data rows after the header, padded to the header width. */
  rows: string[][];
};

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function isZip(bytes: Uint8Array) {
  return bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

function isLegacyXls(bytes: Uint8Array) {
  return bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0;
}

/** First non-empty row is the header; trailing empty columns are dropped. */
function splitHeader(table: string[][]): { headers: string[]; rows: string[][] } {
  const start = table.findIndex((row) => row.some((cell) => cell.trim()));
  if (start < 0) {
    throw new ImportFileError("no_rows");
  }
  const rawHeaders = table[start].map((cell) => cell.trim());
  let width = rawHeaders.length;
  while (width > 0 && !rawHeaders[width - 1]) width -= 1;
  if (width > CLIENT_IMPORT_MAX_COLUMNS) {
    throw new ImportFileError("too_many_columns");
  }
  const headers = rawHeaders.slice(0, width).map((header, index) => header || `Columna ${index + 1}`);
  const rows = table
    .slice(start + 1)
    .map((row) => Array.from({ length: width }, (_, index) => row[index] ?? ""));
  while (rows.length && !rows[rows.length - 1].some((cell) => cell.trim())) rows.pop();
  if (!rows.length) {
    throw new ImportFileError("no_rows");
  }
  if (rows.length > CLIENT_IMPORT_MAX_ROWS) {
    throw new ImportFileError("too_many_rows");
  }
  const tooLong = [rawHeaders, ...rows].findIndex((row) => row.some((cell) => cell.length > CLIENT_IMPORT_MAX_CELL_CHARS));
  if (tooLong >= 0) {
    throw new ImportFileError("cell_too_long", start + tooLong + 1);
  }
  return { headers, rows };
}

/**
 * Reads a CSV or XLSX export entirely in memory (browser, Web Worker or Node).
 * Nothing is uploaded: the caller sends only mapped rows to the server.
 */
export async function parseImportFile(
  input: { name: string; bytes: ArrayBuffer },
  options: { sheet?: string } = {},
): Promise<ParsedImportFile> {
  const { name, bytes } = input;
  if (bytes.byteLength > CLIENT_IMPORT_MAX_FILE_BYTES) {
    throw new ImportFileError("file_too_large");
  }
  if (bytes.byteLength === 0) {
    throw new ImportFileError("empty_file");
  }
  const view = new Uint8Array(bytes);
  const fileSha256 = await sha256Hex(bytes);
  const lowerName = name.toLowerCase();

  if (isLegacyXls(view) || lowerName.endsWith(".xls")) {
    throw new ImportFileError("xls_not_supported");
  }

  if (isZip(view)) {
    let sheets;
    try {
      sheets = await readXlsxSheets(bytes);
    } catch (error) {
      if (error instanceof ImportFileError) throw error;
      throw new ImportFileError("invalid_xlsx");
    }
    const sheet = options.sheet ? sheets.find((item) => item.name === options.sheet) : sheets[0];
    if (!sheet) {
      throw new ImportFileError(options.sheet ? "sheet_not_found" : "no_rows");
    }
    return {
      fileName: name,
      fileSize: bytes.byteLength,
      fileSha256,
      kind: "xlsx",
      encoding: null,
      delimiter: null,
      sheetNames: sheets.map((item) => item.name),
      sheet: sheet.name,
      ...splitHeader(sheet.rows),
    };
  }

  if (!/\.(csv|txt|tsv)$/.test(lowerName) && lowerName.includes(".")) {
    throw new ImportFileError("unsupported_file");
  }
  const { text, encoding } = decodeText(view);
  const { rows, delimiter } = parseCsvText(text);
  return {
    fileName: name,
    fileSize: bytes.byteLength,
    fileSha256,
    kind: "csv",
    encoding,
    delimiter,
    sheetNames: [],
    sheet: null,
    ...splitHeader(rows),
  };
}
