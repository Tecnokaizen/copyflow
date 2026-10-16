import type { MappedClientRow } from "./mapping";

/** Batch as returned by imports_private.batch_json (+ summary rows). */
export type ClientImportBatch = {
  id: string;
  source_system: string;
  file_name: string;
  file_size: number;
  duplicate_strategy: "skip" | "fill_blanks";
  status: "uploaded" | "validated" | "committing" | "committed" | "cancelled" | "reverted" | "expired";
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
  kept?: { client_id: string; reason: "in_use" | "edited" }[];
  rows?: ClientImportSummaryRow[];
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
  errors: string[];
  warnings: string[];
  match_reasons: string[];
  matched_row_number: number | null;
  matched_client: { id: string; name: string; active: boolean } | null;
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
  create: (input: { source_system: string; file_name: string; file_size: number; file_sha256: string; mapping: Record<string, string> }) =>
    post<{ batch: ClientImportBatch }>(BASE, input).then((r) => r.batch),
  summary: (id: string, limit = 200) => request<{ batch: ClientImportBatch }>(`${BASE}/${id}?limit=${limit}`).then((r) => r.batch),
  stage: (id: string, rows: MappedClientRow[]) => post<{ result: { total_rows: number; row_version: number } }>(`${BASE}/${id}/rows`, { rows }),
  finalize: (id: string) => post<{ batch: ClientImportBatch }>(`${BASE}/${id}/finalize`).then((r) => r.batch),
  strategy: (id: string, strategy: "skip" | "fill_blanks", confirm: boolean) =>
    post<{ batch: ClientImportBatch }>(`${BASE}/${id}/strategy`, { strategy, confirm }).then((r) => r.batch),
  decisions: (id: string, rowNumbers: number[], decision: "create" | "skip" | "fill_blanks") =>
    post<{ batch: ClientImportBatch }>(`${BASE}/${id}/decisions`, { row_numbers: rowNumbers, decision }).then((r) => r.batch),
  commit: (id: string, expectedVersion: number, limit = 200) =>
    post<{ batch: ClientImportBatch }>(`${BASE}/${id}/commit`, { expected_version: expectedVersion, limit }).then((r) => r.batch),
  cancel: (id: string) => post<{ batch: ClientImportBatch }>(`${BASE}/${id}/cancel`).then((r) => r.batch),
  revert: (id: string) => post<{ batch: ClientImportBatch }>(`${BASE}/${id}/revert`).then((r) => r.batch),
  reportUrl: (id: string) => `${BASE}/${id}/report`,
};
