import type { SupabaseClient } from "@supabase/supabase-js";

export type PendingOnboardingTenant = {
  id: string;
  slug: string;
  name: string;
  active: boolean;
};

export const ONBOARDING_PENDING_CODES = {
  AMBIGUOUS_PENDING_TENANT: "ambiguous_pending_tenant",
  NO_PENDING_TENANT: "no_pending_tenant",
  TENANT_ALREADY_ACTIVE: "tenant_already_active",
  HAS_COMMERCIAL_SUBSCRIPTION: "has_commercial_subscription",
} as const;

const CURRENT_STRIPE_STATUSES = new Set([
  "trialing",
  "active",
  "past_due",
]);

/**
 * Resolve the single resumable pending commercial tenant for the authenticated user.
 * Fail closed on ambiguity. Never accepts tenant_id from the browser.
 */
export async function resolvePendingCommercialTenant(
  supabase: SupabaseClient,
  userId: string
): Promise<
  | { ok: true; tenant: PendingOnboardingTenant }
  | {
      ok: false;
      code: (typeof ONBOARDING_PENDING_CODES)[keyof typeof ONBOARDING_PENDING_CODES];
      error: string;
    }
> {
  const { data: memberships, error: membershipError } = await supabase
    .from("memberships")
    .select("tenant_id")
    .eq("user_id", userId)
    .eq("role", "owner")
    .eq("active", true);

  if (membershipError) {
    throw new Error(
      `Failed to load owner memberships: ${membershipError.message}`
    );
  }

  const tenantIds = (memberships ?? [])
    .map((row) => row.tenant_id)
    .filter((id): id is string => typeof id === "string");

  if (tenantIds.length === 0) {
    return {
      ok: false,
      code: ONBOARDING_PENDING_CODES.NO_PENDING_TENANT,
      error: "No pending onboarding tenant",
    };
  }

  const { data: tenants, error: tenantsError } = await supabase
    .from("tenants")
    .select("id, slug, name, active")
    .in("id", tenantIds)
    .eq("active", false);

  if (tenantsError) {
    throw new Error(`Failed to load pending tenants: ${tenantsError.message}`);
  }

  const pending = (tenants ?? []).filter(
    (t): t is PendingOnboardingTenant =>
      typeof t.id === "string" &&
      typeof t.slug === "string" &&
      typeof t.name === "string" &&
      t.active === false
  );

  if (pending.length === 0) {
    return {
      ok: false,
      code: ONBOARDING_PENDING_CODES.NO_PENDING_TENANT,
      error: "No pending onboarding tenant",
    };
  }

  if (pending.length > 1) {
    return {
      ok: false,
      code: ONBOARDING_PENDING_CODES.AMBIGUOUS_PENDING_TENANT,
      error: "Ambiguous pending onboarding tenants",
    };
  }

  const tenant = pending[0]!;

  const { data: subscriptions, error: subError } = await supabase
    .from("subscriptions")
    .select("id, provider, status")
    .eq("tenant_id", tenant.id)
    .eq("provider", "stripe");

  if (subError) {
    throw new Error(`Failed to load subscriptions: ${subError.message}`);
  }

  const hasCurrentCommercial = (subscriptions ?? []).some(
    (sub) =>
      typeof sub.status === "string" && CURRENT_STRIPE_STATUSES.has(sub.status)
  );

  if (hasCurrentCommercial) {
    return {
      ok: false,
      code: ONBOARDING_PENDING_CODES.HAS_COMMERCIAL_SUBSCRIPTION,
      error: "Pending tenant already has a commercial subscription",
    };
  }

  return { ok: true, tenant };
}

export function isQualifyingActivationStatus(status: string | null | undefined) {
  return status === "active" || status === "trialing";
}
