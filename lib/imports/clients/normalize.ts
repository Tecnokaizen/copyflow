import { CLIENT_IMPORT_FIELD_LIMITS } from "./limits";
import type { MappedClientRow } from "./mapping";

/**
 * Preview-only mirrors of public.normalize_client_* and of the row checks in
 * client_import_stage_rows. The database repeats every check; these only let
 * the review step show problems before anything is sent.
 */
export function normalizeEmail(value: string | null) {
  const text = value?.trim() ?? "";
  return text ? text.toLowerCase() : null;
}

export function normalizePhone(value: string | null) {
  const digits = (value ?? "").replace(/[^0-9]/g, "");
  return digits || null;
}

export function normalizeTaxId(value: string | null) {
  const text = (value ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  return text || null;
}

/** Same rule as imports_private.phone_core: drops a Spanish 34 / 0034 prefix. */
export function phoneCore(digits: string | null) {
  if (!digits) return null;
  if (digits.length === 13 && digits.startsWith("0034")) return digits.slice(4);
  if (digits.length === 11 && digits.startsWith("34")) return digits.slice(2);
  return digits;
}

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export type RowProblem =
  | "name_required"
  | "invalid_email"
  | "invalid_phone"
  | "invalid_tax_id"
  | `too_long:${keyof typeof CLIENT_IMPORT_FIELD_LIMITS}`;

export function previewRowProblems(row: MappedClientRow): RowProblem[] {
  const problems: RowProblem[] = [];
  if (!row.name?.trim()) problems.push("name_required");
  for (const field of Object.keys(CLIENT_IMPORT_FIELD_LIMITS) as (keyof typeof CLIENT_IMPORT_FIELD_LIMITS)[]) {
    const value = row[field];
    if (value && value.length > CLIENT_IMPORT_FIELD_LIMITS[field]) {
      problems.push(`too_long:${field}`);
    }
  }
  if (row.email && !EMAIL_PATTERN.test(row.email)) problems.push("invalid_email");
  const phone = normalizePhone(row.phone);
  if (row.phone && (!phone || phone.length < 6 || phone.length > 15)) problems.push("invalid_phone");
  const taxId = normalizeTaxId(row.tax_id);
  if (row.tax_id && (!taxId || taxId.length < 5 || taxId.length > 20)) problems.push("invalid_tax_id");
  return problems;
}

export const ROW_PROBLEM_LABELS: Record<string, string> = {
  name_required: "Falta el nombre",
  invalid_email: "Email no válido",
  invalid_phone: "Teléfono no válido",
  invalid_tax_id: "NIF/CIF no válido",
  customer_type_not_found: "Tipo de cliente no encontrado (se omite)",
  "too_long:name": "Nombre demasiado largo",
  "too_long:contact_name": "Contacto demasiado largo",
  "too_long:company_name": "Empresa demasiado larga",
  "too_long:tax_id": "NIF/CIF demasiado largo",
  "too_long:email": "Email demasiado largo",
  "too_long:phone": "Teléfono demasiado largo",
  "too_long:address": "Dirección demasiado larga",
  "too_long:notes": "Notas demasiado largas",
  "too_long:customer_type": "Tipo de cliente demasiado largo",
  "too_long:source_record_id": "Código demasiado largo",
};
