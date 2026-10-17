import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  CURRENT_SUBSCRIPTION_STATUSES,
  INTERNAL_SUBSCRIPTION_CURRENT_CODE,
  hasBlockingNonStripeSubscription,
} from "@/lib/billing/internal-subscription";
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

/**
 * Server-side guard: block new Checkout while a current non-Stripe
 * subscription (internal trial/pilot) exists, in any mode, unless its
 * metadata.billing_activation is 'ready_for_checkout'. The prepare RPC only
 * sees Stripe rows, and a completed Checkout would let
 * sync_billing_subscription_v1 cancel the internal row.
 *
 * No provider filter in SQL: `.neq("provider", "stripe")` would skip NULL.
 */
export async function tenantHasBlockingNonStripeSubscription(
  tenantId: string
): Promise<boolean> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("subscriptions")
    .select("provider, status, metadata")
    .eq("tenant_id", tenantId)
    .in("status", [...CURRENT_SUBSCRIPTION_STATUSES]);

  if (error) {
    throw new Error(
      `Failed to check current non-Stripe subscription: ${error.message}`
    );
  }

  return hasBlockingNonStripeSubscription(
    (data ?? []).map((row) => ({
      provider: typeof row.provider === "string" ? row.provider : null,
      status: typeof row.status === "string" ? row.status : null,
      metadata: row.metadata,
    }))
  );
}

export { CURRENT_SUBSCRIPTION_EXISTS_CODE, INTERNAL_SUBSCRIPTION_CURRENT_CODE };
