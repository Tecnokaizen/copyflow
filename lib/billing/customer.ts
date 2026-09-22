import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { pickStripeCustomerIdForLivemode } from "@/lib/billing/livemode-select";
import {
  getStripeMode,
  stripeModeToLivemode,
} from "@/lib/billing/stripe-config";

export { pickStripeCustomerIdForLivemode };

/**
 * Returns the most recent non-null Stripe customer id for a tenant in the
 * configured STRIPE_MODE. Never returns a Test cus_* when mode is live (or vice versa).
 * Does not create Customers — Checkout creates them when null.
 */
export async function resolveStripeCustomerIdForTenant(
  tenantId: string,
  livemode?: boolean
): Promise<string | null> {
  const expected =
    livemode ?? stripeModeToLivemode(getStripeMode());
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("subscriptions")
    .select("provider_customer_id, livemode, created_at")
    .eq("tenant_id", tenantId)
    .eq("provider", "stripe")
    .eq("livemode", expected)
    .not("provider_customer_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) {
    throw new Error(`Failed to resolve Stripe customer: ${error.message}`);
  }

  return pickStripeCustomerIdForLivemode(
    (data ?? []).map((row) => ({
      provider_customer_id:
        typeof row.provider_customer_id === "string"
          ? row.provider_customer_id
          : null,
      livemode: row.livemode === true,
    })),
    expected
  );
}
