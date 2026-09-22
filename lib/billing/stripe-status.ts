/**
 * Explicit Stripe → local subscription status mapping.
 * Unknown Stripe statuses fail closed (null).
 */
export const STRIPE_SUBSCRIPTION_STATUS_MAP = {
  trialing: "trialing",
  active: "active",
  past_due: "past_due",
  canceled: "canceled",
  unpaid: "unpaid",
  incomplete: "incomplete",
  incomplete_expired: "canceled",
  paused: "paused",
} as const;

export type LocalSubscriptionStatus =
  (typeof STRIPE_SUBSCRIPTION_STATUS_MAP)[keyof typeof STRIPE_SUBSCRIPTION_STATUS_MAP];

export function mapStripeSubscriptionStatus(
  status: string | null | undefined
): LocalSubscriptionStatus | null {
  if (!status) {
    return null;
  }

  if (status in STRIPE_SUBSCRIPTION_STATUS_MAP) {
    return STRIPE_SUBSCRIPTION_STATUS_MAP[
      status as keyof typeof STRIPE_SUBSCRIPTION_STATUS_MAP
    ];
  }

  return null;
}

export function stripeEventCreatedAt(
  createdSeconds: number | null | undefined
): Date | null {
  if (
    typeof createdSeconds !== "number" ||
    !Number.isFinite(createdSeconds) ||
    createdSeconds <= 0
  ) {
    return null;
  }

  return new Date(createdSeconds * 1000);
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}
