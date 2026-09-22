import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { CURRENT_SUBSCRIPTION_EXISTS_CODE } from "@/lib/billing/webhook-errors";

const CURRENT_STRIPE_STATUSES = ["trialing", "active", "past_due"] as const;

/**
 * Server-side guard: block new Checkout when a current Stripe subscription
 * already exists for the tenant (including past_due).
 */
export async function tenantHasCurrentStripeSubscription(
  tenantId: string
): Promise<boolean> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("subscriptions")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("provider", "stripe")
    .in("status", [...CURRENT_STRIPE_STATUSES])
    .limit(1);

  if (error) {
    throw new Error(
      `Failed to check current Stripe subscription: ${error.message}`
    );
  }

  return (data?.length ?? 0) > 0;
}

export { CURRENT_SUBSCRIPTION_EXISTS_CODE };