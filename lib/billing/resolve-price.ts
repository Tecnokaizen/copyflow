import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  getStripeMode,
  stripeModeToLivemode,
  type StripeMode,
} from "@/lib/billing/stripe-config";
import {
  selectStripePriceCandidate,
  type BillingInterval,
  type BillingPriceCandidate,
  type ResolvedStripePrice,
} from "@/lib/billing/select-price";

export type { BillingInterval, ResolvedStripePrice };
export { selectStripePriceCandidate };

export type ResolveStripePriceInput = {
  planCode: string;
  interval: BillingInterval;
  /** Overrides STRIPE_MODE when provided (tests / explicit callers). */
  livemode?: boolean;
  mode?: StripeMode;
};

type BillingPriceJoinRow = {
  id: string;
  provider_price_id: string;
  provider_product_id: string;
  billing_interval: string;
  currency: string;
  unit_amount: number;
  livemode: boolean;
  active: boolean;
  plans:
    | {
        id: string;
        code: string;
        active: boolean;
      }
    | {
        id: string;
        code: string;
        active: boolean;
      }[]
    | null;
};

function normalizePlan(
  plans: BillingPriceJoinRow["plans"]
): { id: string; code: string; active: boolean } | null {
  if (!plans) {
    return null;
  }

  if (Array.isArray(plans)) {
    return plans[0] ?? null;
  }

  return plans;
}

/**
 * Resolve the active Stripe Price for a Gestcopy plan code.
 * Never falls back to hardcoded Price IDs.
 */
export async function resolveStripePrice(
  input: ResolveStripePriceInput
): Promise<ResolvedStripePrice> {
  const planCode = input.planCode.trim();
  if (!planCode) {
    throw new Error("planCode is required");
  }

  if (input.interval !== "month" && input.interval !== "year") {
    throw new Error("interval must be month|year");
  }

  const livemode =
    input.livemode ??
    stripeModeToLivemode(input.mode ?? getStripeMode());

  const admin = createAdminClient();

  const { data, error } = await admin
    .from("billing_prices")
    .select(
      `
      id,
      provider_price_id,
      provider_product_id,
      billing_interval,
      currency,
      unit_amount,
      livemode,
      active,
      plans!inner (
        id,
        code,
        active
      )
    `
    )
    .eq("provider", "stripe")
    .eq("billing_interval", input.interval)
    .eq("livemode", livemode)
    .eq("active", true)
    .eq("plans.code", planCode)
    .eq("plans.active", true);

  if (error) {
    throw new Error(`Failed to resolve Stripe price: ${error.message}`);
  }

  const rows = (data ?? []) as BillingPriceJoinRow[];
  const candidates: BillingPriceCandidate[] = [];

  for (const row of rows) {
    const plan = normalizePlan(row.plans);
    if (!plan) {
      continue;
    }

    if (
      row.billing_interval !== "month" &&
      row.billing_interval !== "year"
    ) {
      continue;
    }

    candidates.push({
      providerPriceId: row.provider_price_id,
      providerProductId: row.provider_product_id,
      billingInterval: row.billing_interval,
      currency: row.currency,
      unitAmount: row.unit_amount,
      livemode: row.livemode,
      active: row.active,
      planId: plan.id,
      planCode: plan.code,
      planActive: plan.active,
    });
  }

  return selectStripePriceCandidate(
    { planCode, interval: input.interval, livemode },
    candidates
  );
}
