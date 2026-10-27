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

/** metadata.billing_activation set by an operator to allow the Stripe conversion. */
export const READY_FOR_CHECKOUT = "ready_for_checkout";

/**
 * A current non-Stripe subscription (provider internal, MVP or NULL) blocks
 * Checkout, unless an operator marked it ready_for_checkout: then the webhook
 * converts it (sync_billing_subscription_v1). "Current" is the stored status
 * only: an internal row whose current_period_end has passed is still current
 * until someone changes its status. Stripe rows are left to
 * prepare_billing_checkout_attempt_v2, which re-checks this rule in-lock.
 */
export function hasCurrentNonStripeSubscription(
  rows: Array<{
    provider: string | null;
    status: string | null;
    metadata?: unknown;
  }>,
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
      allowed.has(row.status) &&
      billingActivation(row.metadata) !== READY_FOR_CHECKOUT
  );
}

function billingActivation(metadata: unknown): unknown {
  return metadata && typeof metadata === "object" && !Array.isArray(metadata)
    ? (metadata as { billing_activation?: unknown }).billing_activation
    : undefined;
}
