/**
 * Client import limits (ADR docs/adr/2026-10-16-clients-import-v1.md).
 * The database enforces the same limits; these only fail fast in the browser.
 */
export const CLIENT_IMPORT_MAX_FILE_BYTES = 5 * 1024 * 1024;
export const CLIENT_IMPORT_MAX_ROWS = 10_000;
export const CLIENT_IMPORT_STAGE_CHUNK = 500;

/**
 * Hostile-file limits. Reading happens in the browser, so these protect the
 * user's tab (the server never receives the file): a small .xlsx can expand to
 * gigabytes, and huge rows or cells can exhaust memory.
 */
export const CLIENT_IMPORT_MAX_UNCOMPRESSED_BYTES = 64 * 1024 * 1024;
export const CLIENT_IMPORT_MAX_ZIP_ENTRIES = 1000;
export const CLIENT_IMPORT_MAX_SHEETS = 50;
export const CLIENT_IMPORT_MAX_COLUMNS = 200;
/** Excel's own maximum characters per cell. */
export const CLIENT_IMPORT_MAX_CELL_CHARS = 32_767;

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
