import { NextResponse } from "next/server";

import { canManageBilling } from "@/lib/billing/access";
import {
  getStripeMode,
  stripeModeToLivemode,
} from "@/lib/billing/stripe-config";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getCurrentContext } from "@/lib/tenant/current-context";

const NO_STORE = {
  "Cache-Control": "private, no-store, max-age=0, must-revalidate",
} as const;

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

const CURRENT = ["trialing", "active", "past_due"] as const;

type SubscriptionRow = {
  id: string;
  status: string;
  provider: string | null;
  livemode: boolean;
  cancel_at_period_end: boolean;
  cancel_at: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  provider_customer_id: string | null;
  plans:
    | {
        code: string;
        name: string;
        price_monthly: number | string | null;
        currency: string;
      }
    | {
        code: string;
        name: string;
        price_monthly: number | string | null;
        currency: string;
      }[]
    | null;
};

const SUBSCRIPTION_SELECT = `
  id,
  status,
  provider,
  livemode,
  cancel_at_period_end,
  cancel_at,
  current_period_start,
  current_period_end,
  provider_customer_id,
  plans (
    code,
    name,
    price_monthly,
    currency
  )
`;

export async function GET() {
  const context = await getCurrentContext();
  if (!context || !canManageBilling(context.membership.role)) {
    return json({ error: "Unauthorized or tenant access denied" }, 403);
  }

  let expectedLivemode: boolean | null = null;
  try {
    expectedLivemode = stripeModeToLivemode(getStripeMode());
  } catch {
    expectedLivemode = null;
  }

  const admin = createAdminClient();
  let row: SubscriptionRow | null = null;

  if (expectedLivemode !== null) {
    const { data: stripeRows, error: stripeError } = await admin
      .from("subscriptions")
      .select(SUBSCRIPTION_SELECT)
      .eq("tenant_id", context.tenant.id)
      .eq("provider", "stripe")
      .eq("livemode", expectedLivemode)
      .in("status", [...CURRENT])
      .order("created_at", { ascending: false })
      .limit(1);

    if (stripeError) {
      console.error("[GET /api/billing/subscription] stripe query failed", {
        message: stripeError.message,
      });
      return json({ error: "Could not load subscription" }, 500);
    }

    row = (stripeRows?.[0] as SubscriptionRow | undefined) ?? null;
  }

  if (!row) {
    const { data: internalRows, error: internalError } = await admin
      .from("subscriptions")
      .select(SUBSCRIPTION_SELECT)
      .eq("tenant_id", context.tenant.id)
      .neq("provider", "stripe")
      .in("status", [...CURRENT])
      .order("created_at", { ascending: false })
      .limit(1);

    if (internalError) {
      console.error("[GET /api/billing/subscription] internal query failed", {
        message: internalError.message,
      });
      return json({ error: "Could not load subscription" }, 500);
    }

    row = (internalRows?.[0] as SubscriptionRow | undefined) ?? null;
  }

  if (!row && expectedLivemode === null) {
    return json({ error: "Billing is not configured" }, 503);
  }

  const display = row;

  const plan = display?.plans
    ? Array.isArray(display.plans)
      ? display.plans[0]
      : display.plans
    : null;

  let storageLimitBytes: number | null = null;
  let storageUsedBytes: number | null = null;

  const supabase = await createClient();
  const { data: filesSettings } = await supabase.rpc(
    "get_tenant_files_settings",
    { p_tenant_id: context.tenant.id }
  );

  if (filesSettings && typeof filesSettings === "object") {
    const record = filesSettings as Record<string, unknown>;
    const limit = record.storage_limit_bytes;
    const used = record.reserved_bytes;
    storageLimitBytes =
      typeof limit === "number"
        ? limit
        : typeof limit === "string"
          ? Number(limit)
          : null;
    storageUsedBytes =
      typeof used === "number"
        ? used
        : typeof used === "string"
          ? Number(used)
          : null;
    if (storageLimitBytes !== null && !Number.isFinite(storageLimitBytes)) {
      storageLimitBytes = null;
    }
    if (storageUsedBytes !== null && !Number.isFinite(storageUsedBytes)) {
      storageUsedBytes = null;
    }
  }

  const isStripe = display?.provider === "stripe";

  return json({
    tenant: {
      id: context.tenant.id,
      slug: context.tenant.slug,
      name: context.tenant.name,
    },
    subscription: display
      ? {
          status: display.status,
          provider: display.provider,
          cancel_at_period_end: display.cancel_at_period_end,
          cancel_at: display.cancel_at,
          current_period_start: display.current_period_start,
          current_period_end: display.current_period_end,
          has_stripe_customer: isStripe
            ? Boolean(display.provider_customer_id)
            : false,
          plan: plan
            ? {
                code: plan.code,
                name: plan.name,
                price_monthly: plan.price_monthly,
                currency: plan.currency,
              }
            : null,
        }
      : null,
    storage: {
      limit_bytes: storageLimitBytes,
      used_bytes: storageUsedBytes,
    },
  });
}
