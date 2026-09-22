/**
 * Pure helpers for selecting Stripe rows by configured livemode.
 */

export function pickStripeCustomerIdForLivemode(
  rows: Array<{
    provider_customer_id: string | null;
    livemode: boolean;
  }>,
  livemode: boolean
): string | null {
  for (const row of rows) {
    if (row.livemode !== livemode) {
      continue;
    }
    const id = row.provider_customer_id;
    if (typeof id === "string" && id.trim().length > 0) {
      return id.trim();
    }
  }
  return null;
}

export function hasCurrentStripeSubscriptionForLivemode(
  rows: Array<{ status: string | null; livemode: boolean }>,
  livemode: boolean,
  currentStatuses: ReadonlySet<string> | readonly string[]
): boolean {
  const allowed =
    currentStatuses instanceof Set
      ? currentStatuses
      : new Set(currentStatuses);

  return rows.some(
    (row) =>
      row.livemode === livemode &&
      typeof row.status === "string" &&
      allowed.has(row.status)
  );
}
