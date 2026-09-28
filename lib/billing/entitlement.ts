/**
 * Commercial access derived from subscriptions.
 * tenants.active stays a provisioning flag and is not read here.
 */

export const STRIPE_CURRENT_STATUSES = ["trialing", "active", "past_due"] as const;
export const INTERNAL_CURRENT_STATUSES = ["trialing", "active"] as const;

export type EntitlementSource = "stripe" | "internal" | "none";

export type EntitlementReason =
  | "stripe_current"
  | "internal_current"
  | "internal_expired"
  | "no_current_subscription";

export type EntitlementSubscription = {
  provider: string | null;
  livemode: boolean;
  status: string | null;
  currentPeriodEnd: string | null;
  planCode: string | null;
};

export type Entitlement = {
  allowed: boolean;
  source: EntitlementSource;
  status: string | null;
  planCode: string | null;
  reason: EntitlementReason;
};

const STRIPE_CURRENT = new Set<string>(STRIPE_CURRENT_STATUSES);
const INTERNAL_CURRENT = new Set<string>(INTERNAL_CURRENT_STATUSES);

export function internalPeriodIsCurrent(
  currentPeriodEnd: string | null,
  now: Date
): boolean {
  if (currentPeriodEnd == null || currentPeriodEnd.trim() === "") {
    return true;
  }
  const end = Date.parse(currentPeriodEnd);
  if (!Number.isFinite(end)) {
    return false;
  }
  return end > now.getTime();
}

export function resolveEntitlement(input: {
  subscriptions: EntitlementSubscription[];
  expectedLivemode: boolean | null;
  now: Date;
}): Entitlement {
  const stripe =
    input.expectedLivemode === null
      ? null
      : input.subscriptions.find(
          (row) =>
            row.provider === "stripe" &&
            row.livemode === input.expectedLivemode &&
            typeof row.status === "string" &&
            STRIPE_CURRENT.has(row.status)
        );

  if (stripe) {
    return {
      allowed: true,
      source: "stripe",
      status: stripe.status,
      planCode: stripe.planCode,
      reason: "stripe_current",
    };
  }

  const internal = input.subscriptions.filter(
    (row) =>
      row.provider !== "stripe" &&
      typeof row.status === "string" &&
      INTERNAL_CURRENT.has(row.status)
  );
  const currentInternal = internal.find((row) =>
    internalPeriodIsCurrent(row.currentPeriodEnd, input.now)
  );
  if (currentInternal) {
    return {
      allowed: true,
      source: "internal",
      status: currentInternal.status,
      planCode: currentInternal.planCode,
      reason: "internal_current",
    };
  }
  if (internal.length > 0) {
    const expired = internal[0];
    return {
      allowed: false,
      source: "internal",
      status: expired.status,
      planCode: expired.planCode,
      reason: "internal_expired",
    };
  }

  return {
    allowed: false,
    source: "none",
    status: null,
    planCode: null,
    reason: "no_current_subscription",
  };
}

/** A current Stripe subscription blocks a second Checkout. Internal current does not. */
export function stripeCheckoutBlocked(entitlement: Entitlement): boolean {
  return entitlement.source === "stripe" && entitlement.allowed;
}
