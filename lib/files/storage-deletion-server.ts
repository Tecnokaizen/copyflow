import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { deleteObject } from "@/lib/storage/r2";
import {
  type ClaimedStorageDeletion,
  type StorageDeletionDeps,
  STORAGE_DELETION_INLINE_LEASE_SECONDS,
  parseClaimedStorageDeletions,
  parseFinishResult,
  runInlineStorageDeletion,
  storageErrorMessage,
} from "./storage-deletion";

type Logger = (message: string, details: Record<string, unknown>) => void;

/** Binds the protocol to service_role RPCs. Server only; never reachable from the browser. */
export function storageDeletionRpcDeps(
  admin: SupabaseClient,
  log: Logger
): StorageDeletionDeps {
  return {
    removeObject: (key) => deleteObject({ key }),
    finish: async ({ id, leaseToken, outcome, error }) => {
      const { data, error: rpcError } = await admin.rpc("finish_storage_deletion", {
        p_id: id,
        p_lease_token: leaseToken,
        p_outcome: outcome,
        p_error: error,
      });
      if (rpcError) throw new Error(rpcError.message);
      const result = parseFinishResult(data);
      if (!result) throw new Error("unexpected finish_storage_deletion result");
      return result;
    },
    log,
  };
}

export async function claimStorageDeletions(
  admin: SupabaseClient,
  limit: number,
  leaseSeconds: number
): Promise<ClaimedStorageDeletion[]> {
  const { data, error } = await admin.rpc("claim_storage_deletions", {
    p_limit: limit,
    p_lease_seconds: leaseSeconds,
  });
  if (error) throw new Error(error.message);
  return parseClaimedStorageDeletions(data);
}

/**
 * Best-effort immediate R2 deletion after a user deletion committed.
 * Failures only delay deletion until the maintenance cron runs.
 */
export async function finalizeUserFileDeletion(
  deletionId: string | null,
  logPrefix: string
): Promise<void> {
  if (!deletionId) return;

  const log: Logger = (message, details) => {
    console.warn(`${logPrefix} ${message}`, details);
  };

  let admin: SupabaseClient;
  try {
    admin = createAdminClient();
  } catch (error) {
    log("inline storage deletion unavailable", {
      deletion_id: deletionId,
      message: storageErrorMessage(error),
    });
    return;
  }

  await runInlineStorageDeletion(deletionId, {
    ...storageDeletionRpcDeps(admin, log),
    claimOne: async (id) => {
      const { data, error } = await admin.rpc("claim_storage_deletion", {
        p_id: id,
        p_lease_seconds: STORAGE_DELETION_INLINE_LEASE_SECONDS,
      });
      if (error) throw new Error(error.message);
      return parseClaimedStorageDeletions(data);
    },
  });
}
