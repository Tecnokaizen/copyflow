import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { isQualifyingActivationStatus } from "@/lib/onboarding/pending-tenant";

export type ActivationOutcome =
  | "activated"
  | "already_active"
  | "not_eligible"
  | "rejected";

export type ActivationResult = {
  outcome: ActivationOutcome;
  reason?: string;
  tenantId?: string;
  slug?: string;
  subscriptionStatus?: string;
};

/**
 * One-way tenant activation after verified Stripe sync.
 * Relies on activate_tenant_after_billing_v1 (service-only).
 */
export async function activateTenantAfterBilling(input: {
  tenantId: string;
  providerSubscriptionId?: string | null;
  subscriptionStatus?: string | null;
}): Promise<ActivationResult | null> {
  if (
    input.subscriptionStatus &&
    !isQualifyingActivationStatus(input.subscriptionStatus)
  ) {
    return {
      outcome: "not_eligible",
      reason: "subscription_status_not_qualifying",
      tenantId: input.tenantId,
      subscriptionStatus: input.subscriptionStatus,
    };
  }

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("activate_tenant_after_billing_v1", {
    p_tenant_id: input.tenantId,
    p_provider_subscription_id: input.providerSubscriptionId ?? null,
  });

  if (error) {
    console.error("[onboarding.activate] activate_tenant_after_billing_v1 failed", {
      message: error.message,
      code: error.code,
    });
    return null;
  }

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return null;
  }

  const record = data as Record<string, unknown>;
  const outcome =
    typeof record.outcome === "string"
      ? (record.outcome as ActivationOutcome)
      : "rejected";

  return {
    outcome,
    reason: typeof record.reason === "string" ? record.reason : undefined,
    tenantId:
      typeof record.tenant_id === "string" ? record.tenant_id : input.tenantId,
    slug: typeof record.slug === "string" ? record.slug : undefined,
    subscriptionStatus:
      typeof record.subscription_status === "string"
        ? record.subscription_status
        : undefined,
  };
}
