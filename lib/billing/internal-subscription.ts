/**
 * Pure helpers for current non-Stripe subscriptions (internal trials and
 * pilots) and their interaction with Stripe Checkout.
 */

export const INTERNAL_SUBSCRIPTION_CURRENT_CODE =
  "internal_subscription_current";

export const CURRENT_SUBSCRIPTION_STATUSES = [
  "trialing",
  "active",
  "past_due",
] as const;

/**
 * A current non-Stripe subscription (provider internal, MVP or NULL) blocks
 * Checkout. "Current" is the stored status only: an internal row whose
 * current_period_end has passed is still current until someone changes its
 * status. Stripe rows are left to prepare_billing_checkout_attempt_v2.
 */
export function hasCurrentNonStripeSubscription(
  rows: Array<{ provider: string | null; status: string | null }>,
  currentStatuses: ReadonlySet<string> | readonly string[] =
    CURRENT_SUBSCRIPTION_STATUSES
): boolean {
  const allowed =
    currentStatuses instanceof Set
      ? currentStatuses
      : new Set(currentStatuses);

  return rows.some(
    (row) =>
      row.provider !== "stripe" &&
      typeof row.status === "string" &&
      allowed.has(row.status)
  );
}
