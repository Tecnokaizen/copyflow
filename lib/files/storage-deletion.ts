import {
  assertQuoteStorageKeyMatchesIds,
  assertStorageKeyMatchesIds,
} from "./object-key";

/**
 * R2 deletion protocol (files_private.storage_deletions outbox).
 *
 * The database reserves first (metadata hidden + task enqueued atomically).
 * These helpers only run after that commit: lease a task, delete the object,
 * finish the task with the lease token. Every step is idempotent, so the
 * inline optimisation and the cron worker may overlap safely.
 */

export const STORAGE_DELETION_BATCH_LIMIT = 100;
export const STORAGE_DELETION_WORKER_LEASE_SECONDS = 300;
export const STORAGE_DELETION_INLINE_LEASE_SECONDS = 60;

export type StorageDeletionKind = "order" | "quote";

export type ClaimedStorageDeletion = {
  id: string;
  file_kind: StorageDeletionKind;
  tenant_id: string;
  parent_id: string;
  file_id: string;
  storage_key: string;
  attempts: number;
  lease_token: string;
};

export type FinishOutcome = "deleted" | "retry" | "abort";

export type FinishResult =
  | "completed"
  | "retry_scheduled"
  | "failed"
  | "stale"
  | "already_completed";

export type StorageDeletionDeps = {
  removeObject: (key: string) => Promise<void>;
  finish: (input: {
    id: string;
    leaseToken: string;
    outcome: FinishOutcome;
    error: string | null;
  }) => Promise<FinishResult>;
  log?: (message: string, details: Record<string, unknown>) => void;
};

export type ProcessResult = FinishResult | "finish_error";

const FINISH_RESULTS = new Set<FinishResult>([
  "completed",
  "retry_scheduled",
  "failed",
  "stale",
  "already_completed",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

export function parseClaimedStorageDeletions(
  data: unknown
): ClaimedStorageDeletion[] {
  if (!Array.isArray(data)) return [];
  const claims: ClaimedStorageDeletion[] = [];
  for (const item of data) {
    if (!isRecord(item)) continue;
    const kind = item.file_kind;
    if (kind !== "order" && kind !== "quote") continue;
    if (
      !nonEmptyString(item.id) ||
      !nonEmptyString(item.tenant_id) ||
      !nonEmptyString(item.parent_id) ||
      !nonEmptyString(item.file_id) ||
      !nonEmptyString(item.storage_key) ||
      !nonEmptyString(item.lease_token)
    ) {
      continue;
    }
    claims.push({
      id: item.id,
      file_kind: kind,
      tenant_id: item.tenant_id,
      parent_id: item.parent_id,
      file_id: item.file_id,
      storage_key: item.storage_key,
      attempts: typeof item.attempts === "number" ? item.attempts : 0,
      lease_token: item.lease_token,
    });
  }
  return claims;
}

export function parseFinishResult(data: unknown): FinishResult | null {
  return typeof data === "string" && FINISH_RESULTS.has(data as FinishResult)
    ? (data as FinishResult)
    : null;
}

/** Storage deletion id returned by soft_delete_order_file / soft_delete_quote_file. */
export function storageDeletionIdFromRpc(data: unknown): string | null {
  if (!isRecord(data)) return null;
  return nonEmptyString(data.storage_deletion_id) ? data.storage_deletion_id : null;
}

export function claimStorageKeyMatchesIds(claim: ClaimedStorageDeletion): boolean {
  try {
    return claim.file_kind === "order"
      ? assertStorageKeyMatchesIds(claim.storage_key, {
          tenantId: claim.tenant_id,
          orderId: claim.parent_id,
          fileId: claim.file_id,
        })
      : assertQuoteStorageKeyMatchesIds(claim.storage_key, {
          tenantId: claim.tenant_id,
          quoteId: claim.parent_id,
          fileId: claim.file_id,
        });
  } catch {
    return false;
  }
}

export function storageErrorMessage(error: unknown): string {
  const name = error instanceof Error ? error.name : "Error";
  const message = error instanceof Error ? error.message : "unknown";
  return `${name}: ${message}`.replace(/[\r\n\t]+/g, " ").slice(0, 300);
}

/** Deletes one leased object and records the outcome. Never throws. */
export async function processClaimedStorageDeletion(
  claim: ClaimedStorageDeletion,
  deps: StorageDeletionDeps
): Promise<ProcessResult> {
  let outcome: FinishOutcome;
  let error: string | null = null;

  if (!claimStorageKeyMatchesIds(claim)) {
    outcome = "abort";
    error = "storage key does not match ids";
  } else {
    try {
      await deps.removeObject(claim.storage_key);
      outcome = "deleted";
    } catch (removeError) {
      outcome = "retry";
      error = storageErrorMessage(removeError);
    }
  }

  try {
    const result = await deps.finish({
      id: claim.id,
      leaseToken: claim.lease_token,
      outcome,
      error,
    });
    if (result !== "completed") {
      deps.log?.("storage deletion not completed", {
        deletion_id: claim.id,
        kind: claim.file_kind,
        file_id: claim.file_id,
        attempts: claim.attempts,
        result,
        error,
      });
    }
    return result;
  } catch (finishError) {
    // The lease expires and another run retries; R2 deletion is idempotent.
    deps.log?.("storage deletion finish failed", {
      deletion_id: claim.id,
      kind: claim.file_kind,
      file_id: claim.file_id,
      message: storageErrorMessage(finishError),
    });
    return "finish_error";
  }
}

export type StorageDeletionBatchSummary = {
  claimed: number;
  completed: number;
  retry_scheduled: number;
  failed: number;
  stale: number;
  finish_errors: number;
};

export async function processStorageDeletionBatch(
  claims: readonly ClaimedStorageDeletion[],
  deps: StorageDeletionDeps
): Promise<StorageDeletionBatchSummary> {
  const summary: StorageDeletionBatchSummary = {
    claimed: claims.length,
    completed: 0,
    retry_scheduled: 0,
    failed: 0,
    stale: 0,
    finish_errors: 0,
  };

  for (const claim of claims) {
    const result = await processClaimedStorageDeletion(claim, deps);
    switch (result) {
      case "completed":
      case "already_completed":
        summary.completed += 1;
        break;
      case "retry_scheduled":
        summary.retry_scheduled += 1;
        break;
      case "failed":
        summary.failed += 1;
        break;
      case "stale":
        summary.stale += 1;
        break;
      case "finish_error":
        summary.finish_errors += 1;
        break;
    }
  }

  return summary;
}

export type InlineStorageDeletionResult =
  | ProcessResult
  | "not_claimed"
  | "claim_error";

/**
 * Optimisation right after a user deletion commits. Uses the same lease as
 * the worker: if the worker holds the task (or it is not due yet), nothing
 * happens here. Never throws; the cron guarantees completion.
 */
export async function runInlineStorageDeletion(
  deletionId: string,
  deps: StorageDeletionDeps & {
    claimOne: (id: string) => Promise<ClaimedStorageDeletion[]>;
  }
): Promise<InlineStorageDeletionResult> {
  let claims: ClaimedStorageDeletion[];
  try {
    claims = await deps.claimOne(deletionId);
  } catch (error) {
    deps.log?.("inline storage deletion claim failed", {
      deletion_id: deletionId,
      message: storageErrorMessage(error),
    });
    return "claim_error";
  }

  const claim = claims.find((item) => item.id === deletionId);
  if (!claim) return "not_claimed";

  return processClaimedStorageDeletion(claim, deps);
}
