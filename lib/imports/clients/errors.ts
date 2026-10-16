/** Lightweight on purpose: imported by browser code without the CSV/XLSX readers. */
export type ImportFileErrorCode =
  | "file_too_large"
  | "empty_file"
  | "xls_not_supported"
  | "unsupported_file"
  | "invalid_xlsx"
  | "sheet_not_found"
  | "no_rows"
  | "too_many_rows";

export class ImportFileError extends Error {
  constructor(readonly code: ImportFileErrorCode) {
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
};
