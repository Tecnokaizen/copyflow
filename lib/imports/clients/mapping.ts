import type { ClientImportField } from "./headers";
import { CLIENT_IMPORT_MAX_ROWS } from "./limits";

/** Field mapped to each column (by index); null = column ignored. */
export type ClientImportMapping = (ClientImportField | null)[];

/** One row ready for client_import_stage_rows (the server revalidates it). */
export type MappedClientRow = {
  row_number: number;
  name: string | null;
  company_name: string | null;
  contact_name: string | null;
  tax_id: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  notes: string | null;
  customer_type: string | null;
  source_record_id: string | null;
};

export type MappingProblem = "name_or_company_required" | `duplicate_field:${ClientImportField}`;

export function validateMapping(mapping: ClientImportMapping): MappingProblem[] {
  const problems: MappingProblem[] = [];
  const seen = new Set<ClientImportField>();
  for (const field of mapping) {
    if (!field) continue;
    if (seen.has(field)) {
      problems.push(`duplicate_field:${field}`);
    }
    seen.add(field);
  }
  if (!seen.has("name") && !seen.has("company_name")) {
    problems.push("name_or_company_required");
  }
  return problems;
}

/** Header -> field object stored with the batch (and hashed for idempotency). */
export function mappingToRecord(headers: string[], mapping: ClientImportMapping): Record<string, string> {
  const record: Record<string, string> = {};
  headers.forEach((header, index) => {
    const field = mapping[index];
    if (field) {
      record[`${index}:${header}`] = field;
    }
  });
  return record;
}

function clean(value: string | undefined): string | null {
  const text = (value ?? "").replace(/ /g, " ").replace(/[ \t]+/g, " ").trim();
  return text ? text : null;
}

/** Several phones or emails in one cell: keep the first, report the rest. */
function splitMultiple(value: string | null, separators: RegExp): { first: string | null; others: string[] } {
  if (!value) return { first: null, others: [] };
  const parts = value.split(separators).map((part) => part.trim()).filter(Boolean);
  return { first: parts[0] ?? null, others: parts.slice(1) };
}

/** "Ana <ana@x.es>; bob@y.es" -> ana@x.es + [bob@y.es]. Unparseable text is kept for the server to reject. */
function splitEmails(value: string | null): { first: string | null; others: string[] } {
  if (!value) return { first: null, others: [] };
  const found = value.match(/[^\s<>;,"'()]+@[^\s<>;,"'()]+/g) ?? [];
  if (!found.length) return { first: value, others: [] };
  return { first: found[0] ?? null, others: found.slice(1) };
}

function joinAddress(street: string | null, postalCode: string | null, city: string | null, province: string | null) {
  const locality = [postalCode, city].filter(Boolean).join(" ");
  const parts = [street, locality || null, province && province !== city ? province : null].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

/**
 * Maps data rows (header excluded) to client rows. Empty rows are skipped but
 * keep their numbering, so row_number always points at the same line of the
 * file (data line N = file line N + 1).
 */
export function mapRows(dataRows: string[][], mapping: ClientImportMapping): MappedClientRow[] {
  const mapped: MappedClientRow[] = [];
  dataRows.forEach((cells, index) => {
    if (!cells.some((cell) => clean(cell))) {
      return;
    }
    const value = (field: ClientImportField) => {
      const column = mapping.indexOf(field);
      return column >= 0 ? clean(cells[column]) : null;
    };

    const phones = splitMultiple(value("phone"), /\s*(?:[\/;|]|\s+y\s+|\s+o\s+)\s*/i);
    const emails = splitEmails(value("email"));
    const extra = [
      phones.others.length ? `Otros teléfonos: ${phones.others.join(", ")}` : null,
      emails.others.length ? `Otros emails: ${emails.others.join(", ")}` : null,
    ].filter(Boolean);
    const notes = [value("notes"), ...extra].filter(Boolean).join("\n") || null;

    mapped.push({
      row_number: index + 1,
      name: value("name") ?? value("company_name"),
      company_name: value("company_name"),
      contact_name: value("contact_name"),
      tax_id: value("tax_id"),
      email: emails.first,
      phone: phones.first,
      address: joinAddress(value("address"), value("postal_code"), value("city"), value("province")),
      notes,
      customer_type: value("customer_type"),
      source_record_id: value("source_record_id"),
    });
  });
  return mapped;
}

export function exceedsRowLimit(dataRows: string[][]) {
  return dataRows.length > CLIENT_IMPORT_MAX_ROWS;
}
