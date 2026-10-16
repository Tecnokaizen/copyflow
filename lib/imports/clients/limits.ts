/**
 * Client import limits (ADR docs/adr/2026-10-16-clients-import-v1.md).
 * The database enforces the same limits; these only fail fast in the browser.
 */
export const CLIENT_IMPORT_MAX_FILE_BYTES = 5 * 1024 * 1024;
export const CLIENT_IMPORT_MAX_ROWS = 10_000;
export const CLIENT_IMPORT_STAGE_CHUNK = 500;
export const CLIENT_IMPORT_COMMIT_CHUNK = 200;

export const CLIENT_IMPORT_FIELD_LIMITS = {
  name: 200,
  contact_name: 200,
  company_name: 200,
  tax_id: 32,
  email: 254,
  phone: 40,
  address: 500,
  notes: 5000,
  customer_type: 120,
  source_record_id: 120,
} as const;
