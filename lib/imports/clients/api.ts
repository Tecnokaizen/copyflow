import type { MappedClientRow } from "./mapping";
import type { ClientImportPlan, ClientImportRowDecision, ClientImportRowFilter } from "./review";

/** Batch as returned by imports_private.batch_json (+ summary rows). */
export type ClientImportBatch = {
  id: string;
  source_system: string;
  file_name: string;
  file_size: number;
  duplicate_strategy: "skip" | "fill_blanks";
  status: "uploaded" | "validated" | "committing" | "committed" | "cancelled" | "reverted" | "expired";
  /** Rows the file declared when the batch was created (null only for batches created before 20261016124000). */
  expected_rows: number | null;
  row_version: number;
  counts: {
    total: number;
    valid: number;
    error: number;
    duplicate_in_file: number;
    duplicate_existing: number;
    possible_duplicate: number;
    created: number;
    filled: number;
    skipped: number;
    /** Part of skipped: rows the user excluded in the review (kept after the 30-day purge). */
    excluded: number;
    failed: number;
    deactivated: number;
    restored: number;
  };
  created_at: string;
  committed_at: string | null;
  reverted_at: string | null;
  expires_at: string;
  rows_purged: boolean;
  reused?: boolean;
  remaining?: number;
  done?: boolean;
  next_row?: number | null;
  kept?: { client_id: string; reason: "in_use" | "edited" }[];
  rows?: ClientImportSummaryRow[];
  /** Summary and decisions: what confirming will do, from every row (null once the rows are purged). */
  plan?: ClientImportPlan | null;
  changed?: number;
};

/** One page of client_import_rows_page: every row of the batch, by filter. */
export type ClientImportRowsPage = ClientImportBatch & {
  filter: ClientImportRowFilter;
  after_row: number;
  /** Rows of the filter in the whole batch. */
  total: number;
  has_more: boolean;
  next_after_row: number | null;
  rows: ClientImportSummaryRow[];
};

export type ClientImportSummaryRow = {
  row_number: number;
  source_record_id: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  tax_id: string | null;
  classification: "valid" | "error" | "duplicate_in_file" | "duplicate_existing" | "possible_duplicate" | null;
  decision: "create" | "fill_blanks" | "skip" | null;
  /** Excluded by the user: never imported, whatever its decision. */
  excluded: boolean;
  company_name?: string | null;
  errors: string[];
  warnings: string[];
  match_reasons: string[];
  matched_row_number: number | null;
  matched_client: {
    id: string;
    name: string;
    active: boolean;
    /** Only in pages, to compare with the row. */
    email?: string | null;
    phone?: string | null;
    tax_id?: string | null;
  } | null;
  result: string | null;
  result_reason: string | null;
};

export class ClientImportApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ClientImportApiError";
  }
}

const BASE = "/api/imports/clients/batches";

/**
 * Rows per call. Measured in Staging (same compute class as Production), each call
 * takes about 0.3–0.6 s, so it stays far below the 8 s DB timeout even when
 * autovacuum or a checkpoint slows the database down several times.
 */
export const CLIENT_IMPORT_FINALIZE_CHUNK = 1000;
export const CLIENT_IMPORT_COMMIT_CHUNK = 100;
export const CLIENT_IMPORT_REVERT_CHUNK = 250;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    cache: "no-store",
  });
  const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok) {
    throw new ClientImportApiError(
      response.status,
      typeof body?.code === "string" ? body.code : "error",
      typeof body?.error === "string" ? body.error : "No se ha podido completar la operación.",
    );
  }
  return body as T;
}

const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });

export const clientImportApi = {
  list: () => request<{ batches: ClientImportBatch[] }>(BASE).then((r) => r.batches),
  create: (input: {
    source_system: string;
    file_name: string;
    file_size: number;
    file_sha256: string;
    mapping: Record<string, string>;
    expected_rows: number;
  }) =>
    post<{ batch: ClientImportBatch }>(BASE, input).then((r) => r.batch),
  /** Counters and plan; the review reads its rows page by page (rows), so by default just one. */
  summary: (id: string, limit = 1) => request<{ batch: ClientImportBatch }>(`${BASE}/${id}?limit=${limit}`).then((r) => r.batch),
  stage: (id: string, rows: MappedClientRow[]) => post<{ result: { total_rows: number; row_version: number } }>(`${BASE}/${id}/rows`, { rows }),
  finalize: (id: string, fromRow = 1, limit = CLIENT_IMPORT_FINALIZE_CHUNK) =>
    post<{ batch: ClientImportBatch }>(`${BASE}/${id}/finalize`, { from_row: fromRow, limit }).then((r) => r.batch),
  strategy: (id: string, strategy: "skip" | "fill_blanks", confirm: boolean) =>
    post<{ batch: ClientImportBatch }>(`${BASE}/${id}/strategy`, { strategy, confirm }).then((r) => r.batch),
  rows: (id: string, filter: ClientImportRowFilter, afterRow: number, limit: number) =>
    request<{ page: ClientImportRowsPage }>(
      `${BASE}/${id}/rows?${new URLSearchParams({ filter, after: String(afterRow), limit: String(limit) })}`,
    ).then((r) => r.page),
  decisions: (id: string, rowNumbers: number[], decision: ClientImportRowDecision) =>
    post<{ batch: ClientImportBatch }>(`${BASE}/${id}/decisions`, { row_numbers: rowNumbers, decision }).then((r) => r.batch),
  commit: (id: string, expectedVersion: number, limit = CLIENT_IMPORT_COMMIT_CHUNK) =>
    post<{ batch: ClientImportBatch }>(`${BASE}/${id}/commit`, { expected_version: expectedVersion, limit }).then((r) => r.batch),
  cancel: (id: string) => post<{ batch: ClientImportBatch }>(`${BASE}/${id}/cancel`).then((r) => r.batch),
  revert: (id: string, limit = CLIENT_IMPORT_REVERT_CHUNK) => post<{ batch: ClientImportBatch }>(`${BASE}/${id}/revert`, { limit }).then((r) => r.batch),
  reportUrl: (id: string) => `${BASE}/${id}/report`,
};
