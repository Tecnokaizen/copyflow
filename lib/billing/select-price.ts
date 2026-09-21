export type BillingInterval = "month" | "year";

export type ResolvedStripePrice = {
  planId: string;
  planCode: string;
  providerPriceId: string;
  providerProductId: string;
  billingInterval: BillingInterval;
  currency: string;
  unitAmount: number;
  livemode: boolean;
};

export type BillingPriceCandidate = {
  providerPriceId: string;
  providerProductId: string;
  billingInterval: BillingInterval;
  currency: string;
  unitAmount: number;
  livemode: boolean;
  active: boolean;
  planId: string;
  planCode: string;
  planActive: boolean;
};

/**
 * Pure selection used by resolveStripePrice after the DB query.
 * Enforces active plan + active price + exactly one match.
 */
export function selectStripePriceCandidate(
  input: {
    planCode: string;
    interval: BillingInterval;
    livemode: boolean;
  },
  candidates: BillingPriceCandidate[]
): ResolvedStripePrice {
  const matches = candidates.filter(
    (row) =>
      row.planCode === input.planCode &&
      row.planActive &&
      row.active &&
      row.billingInterval === input.interval &&
      row.livemode === input.livemode
  );

  if (matches.length === 0) {
    throw new Error(
      `No active Stripe price for plan=${input.planCode} interval=${input.interval} livemode=${input.livemode}`
    );
  }

  if (matches.length > 1) {
    throw new Error(
      `Ambiguous Stripe price mapping for plan=${input.planCode} interval=${input.interval} livemode=${input.livemode}`
    );
  }

  const row = matches[0];

  return {
    planId: row.planId,
    planCode: row.planCode,
    providerPriceId: row.providerPriceId,
    providerProductId: row.providerProductId,
    billingInterval: row.billingInterval,
    currency: row.currency,
    unitAmount: row.unitAmount,
    livemode: row.livemode,
  };
}
