import { ROW_PROBLEM_LABELS } from "./normalize";

/** One row of client_import_report. */
export type ClientImportReportRow = {
  row_number: number;
  source_record_id: string | null;
  name: string | null;
  classification: string | null;
  decision: string | null;
  result: string | null;
  result_reason: string | null;
  errors: string[];
  warnings: string[];
  client_id: string | null;
  revert_result: string | null;
};

const CLASSIFICATION_LABELS: Record<string, string> = {
  valid: "Válida",
  error: "Con errores",
  duplicate_in_file: "Repetida en el archivo",
  duplicate_existing: "Ya existe en Gestcopy",
  possible_duplicate: "Posible duplicado",
};

const RESULT_LABELS: Record<string, string> = {
  created: "Creado",
  filled: "Completado",
  skipped: "Omitido",
  failed: "Error",
};

const DECISION_LABELS: Record<string, string> = {
  create: "Crear",
  fill_blanks: "Completar campos vacíos",
  skip: "Omitir",
};

const REASON_LABELS: Record<string, string> = {
  client_duplicate: "Ya existe un cliente con ese email, teléfono o NIF",
  nothing_to_fill: "No había campos vacíos que completar",
  error: "Fila con errores",
  duplicate_in_file: "Repetida en el archivo",
  duplicate_existing: "Ya existe en Gestcopy",
  possible_duplicate: "Posible duplicado (omitido)",
  skip: "Omitida",
};

const REVERT_LABELS: Record<string, string> = {
  deactivated: "Desactivado",
  restored: "Campos restaurados",
  kept_in_use: "Se mantiene (en uso)",
  kept_edited: "Se mantiene (editado después)",
  not_applicable: "",
};

/**
 * Prevents CSV/formula injection when the report is opened in a spreadsheet:
 * cells starting with = + - @ tab or carriage return are prefixed with '.
 */
export function neutralizeCell(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

function quote(value: string, delimiter: string): string {
  const safe = neutralizeCell(value);
  return /["\r\n]/.test(safe) || safe.includes(delimiter) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

const label = (labels: Record<string, string>, code: string | null) => (code ? labels[code] ?? code : "");

export function buildImportReportCsv(rows: ClientImportReportRow[], delimiter = ";"): string {
  const header = [
    "Fila",
    "Código de origen",
    "Nombre",
    "Clasificación",
    "Decisión",
    "Resultado",
    "Motivo",
    "Errores",
    "Avisos",
    "ID del cliente",
    "Reversión",
  ];
  const lines = rows.map((row) =>
    [
      String(row.row_number),
      row.source_record_id ?? "",
      row.name ?? "",
      label(CLASSIFICATION_LABELS, row.classification),
      label(DECISION_LABELS, row.decision),
      label(RESULT_LABELS, row.result),
      label(REASON_LABELS, row.result_reason),
      row.errors.map((code) => ROW_PROBLEM_LABELS[code] ?? code).join(" · "),
      row.warnings.map((code) => ROW_PROBLEM_LABELS[code] ?? code).join(" · "),
      row.client_id ?? "",
      label(REVERT_LABELS, row.revert_result),
    ]
      .map((cell) => quote(cell, delimiter))
      .join(delimiter),
  );
  // BOM so Excel opens UTF-8 correctly; CRLF line endings.
  return `﻿${[header.join(delimiter), ...lines].join("\r\n")}\r\n`;
}
