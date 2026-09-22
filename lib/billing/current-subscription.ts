import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { hasCurrentStripeSubscriptionForLivemode } from "@/lib/billing/livemode-select";
import {
  getStripeMode,
  stripeModeToLivemode,
} from "@/lib/billing/stripe-config";
import { CURRENT_SUBSCRIPTION_EXISTS_CODE } from "@/lib/billing/webhook-errors";

const CURRENT_STRIPE_STATUSES = ["trialing", "active", "past_due"] as const;

export { hasCurrentStripeSubscriptionForLivemode };

/**
 * Server-side guard: block new Checkout when a current Stripe subscription
 * already exists for the tenant in the configured STRIPE_MODE (including past_due).
 */
export async function tenantHasCurrentStripeSubscription(
  tenantId: string,
  livemode?: boolean
): Promise<boolean> {
  const expected =
    livemode ?? stripeModeToLivemode(getStripeMode());
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("subscriptions")
    .select("id, status, livemode")
    .eq("tenant_id", tenantId)
    .eq("provider", "stripe")
    .eq("livemode", expected)
    .in("status", [...CURRENT_STRIPE_STATUSES])
    .limit(1);

  if (error) {
    throw new Error(
      `Failed to check current Stripe subscription: ${error.message}`
    );
  }

  return hasCurrentStripeSubscriptionForLivemode(
    (data ?? []).map((row) => ({
      status: typeof row.status === "string" ? row.status : null,
      livemode: row.livemode === true,
    })),
    expected,
    CURRENT_STRIPE_STATUSES
  );
}

export { CURRENT_SUBSCRIPTION_EXISTS_CODE };
