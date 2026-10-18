/**
 * Classifies the jsonb returned by sync_billing_subscription_v1.
 * held: a current internal (non-Stripe) subscription blocked the sync and
 * nothing was written. stale: an older provider event was ignored.
 */
export type SyncResultOutcome = "synced" | "stale" | "held";

export function classifySyncResult(data: unknown): SyncResultOutcome {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return "synced";
  }

  const record = data as { outcome?: unknown; held?: unknown; stale?: unknown };

  if (record.outcome === "held" || record.held === true) {
    return "held";
  }

  if (record.stale === true) {
    return "stale";
  }

  return "synced";
}

/** Hold id and whether this sync opened (or reopened) the hold. */
export function heldSyncDetails(data: unknown): {
  holdId: string | null;
  holdCreated: boolean;
} {
  const record =
    data && typeof data === "object" && !Array.isArray(data)
      ? (data as { hold_id?: unknown; hold_created?: unknown })
      : {};
  return {
    holdId: typeof record.hold_id === "string" ? record.hold_id : null,
    holdCreated: record.hold_created === true,
  };
}
