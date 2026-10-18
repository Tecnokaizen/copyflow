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
