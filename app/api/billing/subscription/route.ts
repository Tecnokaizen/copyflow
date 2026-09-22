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

const CURRENT = new Set(["trialing", "active", "past_due"]);

export async function GET() {
  const context = await getCurrentContext();
  if (!context || !canManageBilling(context.membership.role)) {
    return json({ error: "Unauthorized or tenant access denied" }, 403);
  }

  let livemode: boolean;
  try {
    livemode = stripeModeToLivemode(getStripeMode());
  } catch {
    return json({ error: "Billing is not configured" }, 503);
  }

  const admin = createAdminClient();
  const { data: rows, error } = await admin
    .from("subscriptions")
    .select(
      `
      id,
      status,
      provider,
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
    `
    )
    .eq("tenant_id", context.tenant.id)
    .eq("provider", "stripe")
    .eq("livemode", livemode)
    .in("status", [...CURRENT])
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) {
    console.error("[GET /api/billing/subscription] failed", {
      message: error.message,
    });
    return json({ error: "Could not load subscription" }, 500);
  }

  const row = rows?.[0] as
    | {
        id: string;
        status: string;
        provider: string | null;
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
      }
    | undefined;

  const plan = row?.plans
    ? Array.isArray(row.plans)
      ? row.plans[0]
      : row.plans
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

  return json({
    tenant: {
      id: context.tenant.id,
      slug: context.tenant.slug,
      name: context.tenant.name,
    },
    subscription: row
      ? {
          status: row.status,
          provider: row.provider,
          cancel_at_period_end: row.cancel_at_period_end,
          cancel_at: row.cancel_at,
          current_period_start: row.current_period_start,
          current_period_end: row.current_period_end,
          has_stripe_customer: Boolean(row.provider_customer_id),
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
