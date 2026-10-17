/** Lightweight on purpose: imported by browser code without the CSV/XLSX readers. */
export type ImportFileErrorCode =
  | "file_too_large"
  | "empty_file"
  | "xls_not_supported"
  | "unsupported_file"
  | "invalid_xlsx"
  | "sheet_not_found"
  | "no_rows"
  | "too_many_rows"
  | "csv_unterminated_quote"
  | "xlsx_too_large"
  | "xlsx_unsafe"
  | "too_many_sheets"
  | "too_many_columns"
  | "cell_too_long";

export class ImportFileError extends Error {
  constructor(
    readonly code: ImportFileErrorCode,
    /** 1-based line of the file where the problem starts, when known. */
    readonly line?: number,
  ) {
    super(code);
    this.name = "ImportFileError";
  }
}

export const IMPORT_FILE_ERROR_LABELS: Record<ImportFileErrorCode, string> = {
  file_too_large: "El archivo supera 5 MB.",
  empty_file: "El archivo está vacío.",
  xls_not_supported: "Los archivos .xls antiguos no se admiten. Guárdalo como .xlsx o CSV desde Excel.",
  unsupported_file: "Formato no admitido. Usa CSV o XLSX.",
  invalid_xlsx: "No se ha podido leer el archivo XLSX.",
  sheet_not_found: "No se encuentra la hoja elegida.",
  no_rows: "El archivo no tiene filas de clientes.",
  too_many_rows: "El archivo tiene más de 10.000 filas. Divídelo en varios archivos.",
  csv_unterminated_quote:
    "El archivo tiene unas comillas sin cerrar y no se puede leer entero. Revisa esa línea o guárdalo de nuevo como CSV desde Excel.",
  xlsx_too_large: "El archivo XLSX ocupa más de 64 MB una vez descomprimido. Guárdalo como CSV o divídelo en varios archivos.",
  xlsx_unsafe:
    "El archivo XLSX tiene contenido que no se admite (cifrado, definiciones XML o una estructura dañada). Ábrelo en Excel y guárdalo de nuevo, o expórtalo como CSV.",
  too_many_sheets: "El archivo tiene más de 50 hojas. Deja solo la hoja de clientes.",
  too_many_columns: "El archivo tiene más de 200 columnas. Quita las que no necesites.",
  cell_too_long: "Una celda supera 32.767 caracteres, el máximo de Excel.",
};

/** Message for an ImportFileError, with the line when the reader knows it. */
export function importFileErrorMessage(error: ImportFileError) {
  const base = IMPORT_FILE_ERROR_LABELS[error.code];
  return error.line ? `${base} (línea ${error.line})` : base;
}
