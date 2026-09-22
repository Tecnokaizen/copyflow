import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

export type ResolvedPlanFromPrice = {
  planId: string;
  planCode: string;
  providerPriceId: string;
  livemode: boolean;
};

/**
 * Resolve local plan from a Stripe Price ID via billing_prices mapping.
 * Does not trust subscription metadata.plan_code as authority.
 */
export async function resolvePlanFromStripePriceId(input: {
  providerPriceId: string;
  livemode: boolean;
}): Promise<ResolvedPlanFromPrice | null> {
  const priceId = input.providerPriceId.trim();
  if (!priceId) {
    return null;
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("billing_prices")
    .select(
      `
      provider_price_id,
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
    .eq("provider_price_id", priceId)
    .eq("livemode", input.livemode)
    .eq("active", true)
    .eq("plans.active", true)
    .limit(2);

  if (error) {
    throw new Error(`Failed to resolve plan from price: ${error.message}`);
  }

  const rows = data ?? [];
  if (rows.length !== 1) {
    return null;
  }

  const row = rows[0] as {
    provider_price_id: string;
    livemode: boolean;
    plans:
      | { id: string; code: string; active: boolean }
      | { id: string; code: string; active: boolean }[];
  };

  const plan = Array.isArray(row.plans) ? row.plans[0] : row.plans;
  if (!plan?.id || !plan.code) {
    return null;
  }

  return {
    planId: plan.id,
    planCode: plan.code,
    providerPriceId: row.provider_price_id,
    livemode: row.livemode,
  };
}
