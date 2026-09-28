import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  resolveEntitlement,
  type Entitlement,
  type EntitlementSubscription,
} from "@/lib/billing/entitlement";
import {
  getStripeMode,
  stripeModeToLivemode,
} from "@/lib/billing/stripe-config";

type SubscriptionQueryRow = {
  provider: string | null;
  livemode: boolean | null;
  status: string | null;
  current_period_end: string | null;
  plans:
    | { code: string }
    | { code: string }[]
    | null;
};

function planCode(plans: SubscriptionQueryRow["plans"]): string | null {
  if (!plans) return null;
  const plan = Array.isArray(plans) ? plans[0] : plans;
  return typeof plan?.code === "string" ? plan.code : null;
}

export function expectedStripeLivemode(): boolean | null {
  try {
    return stripeModeToLivemode(getStripeMode());
  } catch {
    return null;
  }
}

export async function loadTenantSubscriptions(
  tenantId: string
): Promise<EntitlementSubscription[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("subscriptions")
    .select(
      "provider, livemode, status, current_period_end, plans(code), created_at"
    )
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return ((data ?? []) as SubscriptionQueryRow[]).map((row) => ({
    provider: row.provider,
    livemode: row.livemode === true,
    status: row.status,
    currentPeriodEnd: row.current_period_end,
    planCode: planCode(row.plans),
  }));
}

export async function loadActiveTenantIdBySlug(
  slug: string
): Promise<string | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("tenants")
    .select("id")
    .eq("slug", slug)
    .eq("active", true)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return typeof data?.id === "string" ? data.id : null;
}

export async function loadTenantEntitlement(
  tenantId: string,
  now = new Date()
): Promise<Entitlement> {
  const subscriptions = await loadTenantSubscriptions(tenantId);
  return resolveEntitlement({
    subscriptions,
    expectedLivemode: expectedStripeLivemode(),
    now,
  });
}
