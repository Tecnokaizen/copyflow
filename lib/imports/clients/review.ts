import type { ClientImportSummaryRow } from "./api";
import { ROW_PROBLEM_LABELS } from "./normalize";

/** Filters of client_import_rows_page (20261016126000). */
export const CLIENT_IMPORT_ROW_FILTERS = [
  "attention",
  "all",
  "valid",
  "error",
  "duplicate_in_file",
  "duplicate_existing",
  "possible_duplicate",
  "excluded",
  "create",
  "fill_blanks",
  "skip",
] as const;

export type ClientImportRowFilter = (typeof CLIENT_IMPORT_ROW_FILTERS)[number];

/** create/skip/fill_blanks change the decision; exclude/include only the exclusion. */
export const CLIENT_IMPORT_ROW_DECISIONS = ["create", "skip", "fill_blanks", "exclude", "include"] as const;

export type ClientImportRowDecision = (typeof CLIENT_IMPORT_ROW_DECISIONS)[number];

/** Rows per review page; the RPC accepts up to CLIENT_IMPORT_MAX_PAGE_SIZE. */
export const CLIENT_IMPORT_PAGE_SIZE = 50;
export const CLIENT_IMPORT_MAX_PAGE_SIZE = 200;

export const isRowFilter = (value: unknown): value is ClientImportRowFilter =>
  typeof value === "string" && (CLIENT_IMPORT_ROW_FILTERS as readonly string[]).includes(value);

export const isRowDecision = (value: unknown): value is ClientImportRowDecision =>
  typeof value === "string" && (CLIENT_IMPORT_ROW_DECISIONS as readonly string[]).includes(value);

/**
 * What confirming the batch will do, computed by the server from every row
 * (imports_private.batch_plan). create, fill_blanks, skip, excluded, error,
 * duplicate_in_file and unclassified are disjoint and add up to total;
 * create_possible, skip_existing and skip_possible are parts of them.
 */
export type ClientImportPlan = {
  create: number;
  create_possible: number;
  fill_blanks: number;
  skip: number;
  skip_existing: number;
  skip_possible: number;
  excluded: number;
  error: number;
  duplicate_in_file: number;
  unclassified: number;
  total: number;
};

/** Rows the confirmation leaves out, for any reason. */
export function planLeftOut(plan: ClientImportPlan) {
  return plan.skip + plan.excluded + plan.error + plan.duplicate_in_file + plan.unclassified;
}

export type ClientImportRowOutcome = "create" | "fill_blanks" | "skip" | "excluded" | "not_importable" | "pending";

/** The group of the plan a row belongs to: the same rules as batch_plan and commit_chunk. */
export function rowOutcome(row: Pick<ClientImportSummaryRow, "classification" | "decision" | "excluded">): ClientImportRowOutcome {
  if (row.excluded) return "excluded";
  if (row.decision === "create" || row.decision === "fill_blanks") return row.decision;
  if (row.classification === null) return "pending";
  if (row.classification === "error" || row.classification === "duplicate_in_file") return "not_importable";
  return "skip";
}

export type ClientImportRowAction = { decision: ClientImportRowDecision; label: string };

/**
 * What the user can change on a row while the batch is under review. Rows with
 * errors or repeated in the file are never imported; existing duplicates
 * follow the batch strategy and can only be excluded one by one.
 */
export function rowActions(
  row: Pick<ClientImportSummaryRow, "classification" | "decision" | "excluded">,
): ClientImportRowAction[] {
  if (row.classification === null || row.classification === "error" || row.classification === "duplicate_in_file") return [];
  if (row.excluded) return [{ decision: "include", label: "Volver a incluir" }];
  const exclude: ClientImportRowAction = { decision: "exclude", label: "Excluir" };
  if (row.classification === "possible_duplicate") {
    return row.decision === "create"
      ? [{ decision: "skip", label: "No crear" }, exclude]
      : [{ decision: "create", label: "Crear igualmente" }, exclude];
  }
  return [exclude];
}

export const ROW_FILTER_LABELS: Record<ClientImportRowFilter, string> = {
  attention: "Para revisar",
  all: "Todas",
  valid: "Nuevas",
  error: "Con errores",
  duplicate_in_file: "Repetidas en el archivo",
  duplicate_existing: "Ya existen",
  possible_duplicate: "Posibles duplicados",
  excluded: "Excluidas",
  create: "Se crearán",
  fill_blanks: "Se completarán",
  skip: "Se omiten",
};

export const ROW_OUTCOME_LABELS: Record<ClientImportRowOutcome, string> = {
  create: "Se creará",
  fill_blanks: "Completará campos vacíos",
  skip: "Se omite",
  excluded: "Excluida por ti",
  not_importable: "No se puede importar",
  pending: "Sin revisar",
};

export const MATCH_LABELS: Record<string, string> = {
  email: "email",
  phone: "teléfono",
  tax_id: "NIF/CIF",
  source_record: "código de origen",
  phone_prefix: "teléfono sin prefijo +34",
};

/** Why a row is where it is, in the words of the review. */
export function rowSituation(
  row: Pick<ClientImportSummaryRow, "classification" | "errors" | "warnings" | "match_reasons" | "matched_row_number" | "matched_client">,
): string {
  const client = row.matched_client;
  const clientName = client ? `«${client.name}»${client.active ? "" : " (inactivo)"}` : "un cliente existente";
  const reasons = row.match_reasons.map((reason) => MATCH_LABELS[reason] ?? reason).join(", ");
  switch (row.classification) {
    case "error":
      return row.errors.map((code) => ROW_PROBLEM_LABELS[code] ?? code).join(", ");
    case "duplicate_in_file":
      return `Repite la fila ${row.matched_row_number} (mismo ${reasons})`;
    case "duplicate_existing":
      return `Ya existe: ${clientName} (mismo ${reasons})`;
    case "possible_duplicate":
      return `Posible duplicado de ${clientName}${client?.phone ? `, ${client.phone}` : ""} (mismo teléfono sin prefijo +34)`;
    case "valid":
      return ["Nueva", ...row.warnings.map((code) => ROW_PROBLEM_LABELS[code] ?? code)].join(" · ");
    default:
      return "Sin revisar";
  }
}
