/**
 * Pure helpers for current non-Stripe subscriptions (internal trials and
 * pilots) and their interaction with Stripe Checkout.
 */

export const INTERNAL_SUBSCRIPTION_CURRENT_CODE =
  "internal_subscription_current";

/** Owner may replace the internal subscription through Stripe Checkout. */
export const BILLING_ACTIVATION_READY_FOR_CHECKOUT = "ready_for_checkout";

export const CURRENT_SUBSCRIPTION_STATUSES = [
  "trialing",
  "active",
  "past_due",
] as const;

export function billingActivationFromMetadata(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }
  const value = (metadata as Record<string, unknown>).billing_activation;
  return typeof value === "string" ? value : null;
}

export function isReadyForCheckout(metadata: unknown): boolean {
  return (
    billingActivationFromMetadata(metadata) ===
    BILLING_ACTIVATION_READY_FOR_CHECKOUT
  );
}

/**
 * A current non-Stripe subscription (provider internal, MVP or NULL) blocks
 * Checkout unless metadata.billing_activation is exactly 'ready_for_checkout'.
 * Stripe rows are left to prepare_billing_checkout_attempt_v2 (mode-scoped).
 */
export function hasBlockingNonStripeSubscription(
  rows: Array<{
    provider: string | null;
    status: string | null;
    metadata: unknown;
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
      !isReadyForCheckout(row.metadata)
  );
}
