import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Returns the most recent non-null Stripe customer id for a tenant, if any.
 * Does not create Customers — Checkout creates them when null.
 */
export async function resolveStripeCustomerIdForTenant(
  tenantId: string
): Promise<string | null> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("subscriptions")
    .select("provider_customer_id, created_at")
    .eq("tenant_id", tenantId)
    .eq("provider", "stripe")
    .not("provider_customer_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) {
    throw new Error(`Failed to resolve Stripe customer: ${error.message}`);
  }

  for (const row of data ?? []) {
    const id = row.provider_customer_id;
    if (typeof id === "string" && id.trim().length > 0) {
      return id.trim();
    }
  }

  return null;
}
