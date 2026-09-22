import { NextRequest, NextResponse } from "next/server";

import { CHECKOUT_MODE_MISMATCH_CODE } from "@/lib/billing/checkout-attempts";
import { resolveTenantIdFromCheckoutSession } from "@/lib/billing/tenant-from-webhook";
import { getStripe } from "@/lib/billing/stripe";
import {
  assertStripeConfig,
  stripeModeToLivemode,
} from "@/lib/billing/stripe-config";
import { resolveOnboardingStatusState } from "@/lib/onboarding/pending-tenant";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getSubdomainFromHostname } from "@/lib/tenant/hostname";

const NO_STORE = {
  "Cache-Control": "private, no-store, max-age=0, must-revalidate",
} as const;

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

function isTenantHostFromRequest(request: NextRequest) {
  const hostname =
    request.headers.get("x-forwarded-host") ??
    request.headers.get("host") ??
    "";
  return getSubdomainFromHostname(hostname) !== null;
}

export async function GET(request: NextRequest) {
  if (isTenantHostFromRequest(request)) {
    return json(
      { error: "Onboarding status is only available on the app host" },
      403
    );
  }

  const stripeConfig = assertStripeConfig();
  if (!stripeConfig.ok) {
    return json({ error: "Billing is not configured" }, 503);
  }
  const expectedLivemode = stripeModeToLivemode(stripeConfig.mode);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return json({ error: "Unauthorized" }, 401);
  }

  const sessionId = request.nextUrl.searchParams.get("session_id")?.trim();
  if (!sessionId || !sessionId.startsWith("cs_")) {
    return json({ error: "Invalid session_id" }, 400);
  }

  let stripeSession;
  try {
    stripeSession = await getStripe().checkout.sessions.retrieve(sessionId);
  } catch (error) {
    console.error("[GET /api/onboarding/status] stripe retrieve failed", {
      message: error instanceof Error ? error.message : "unknown",
    });
    return json({ error: "Could not validate checkout session" }, 400);
  }

  // Fail closed before tenant/membership/attempt/subscription work.
  if (stripeSession.livemode !== expectedLivemode) {
    console.error("[GET /api/onboarding/status] checkout_mode_mismatch", {
      sessionId,
      sessionLivemode: stripeSession.livemode,
      expectedLivemode,
    });
    return json(
      {
        error: "Checkout session livemode does not match STRIPE_MODE",
        code: CHECKOUT_MODE_MISMATCH_CODE,
      },
      400
    );
  }

  if (stripeSession.mode !== "subscription") {
    return json({ error: "Checkout session is not a subscription" }, 400);
  }

  const resolvedTenant = resolveTenantIdFromCheckoutSession({
    client_reference_id: stripeSession.client_reference_id,
    metadata: stripeSession.metadata,
  });

  if (!resolvedTenant.ok) {
    return json(
      {
        error: "Checkout session tenant reference is invalid",
        code: resolvedTenant.errorCode,
      },
      400
    );
  }

  const tenantId = resolvedTenant.tenantId;

  const { data: membership, error: membershipError } = await supabase
    .from("memberships")
    .select("tenant_id, role, active")
    .eq("user_id", user.id)
    .eq("tenant_id", tenantId)
    .eq("role", "owner")
    .eq("active", true)
    .maybeSingle();

  if (membershipError || !membership) {
    return json({ error: "Forbidden" }, 403);
  }

  const admin = createAdminClient();

  // Correlate session against a Gestcopy checkout attempt for this tenant+mode.
  const { data: attempt, error: attemptError } = await admin
    .from("billing_checkout_attempts")
    .select("id, livemode")
    .eq("tenant_id", tenantId)
    .eq("provider", "stripe")
    .eq("provider_session_id", sessionId)
    .eq("livemode", expectedLivemode)
    .maybeSingle();

  if (attemptError || !attempt) {
    return json({ error: "Checkout session is not recognized" }, 400);
  }

  const { data: tenant, error: tenantError } = await admin
    .from("tenants")
    .select("id, slug, name, active, provisioning_state")
    .eq("id", tenantId)
    .maybeSingle();

  if (tenantError || !tenant) {
    return json({ error: "Tenant not found" }, 404);
  }

  const { data: subscription } = await admin
    .from("subscriptions")
    .select("status, provider")
    .eq("tenant_id", tenantId)
    .eq("provider", "stripe")
    .eq("livemode", expectedLivemode)
    .in("status", [
      "trialing",
      "active",
      "past_due",
      "incomplete",
      "unpaid",
      "canceled",
      "paused",
    ])
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const state = resolveOnboardingStatusState({
    tenantActive: tenant.active === true,
    provisioningState:
      typeof tenant.provisioning_state === "string"
        ? tenant.provisioning_state
        : null,
    sessionStatus:
      typeof stripeSession.status === "string" ? stripeSession.status : null,
    paymentStatus:
      typeof stripeSession.payment_status === "string"
        ? stripeSession.payment_status
        : null,
    subscriptionStatus:
      subscription && typeof subscription.status === "string"
        ? subscription.status
        : null,
  });

  // session_id alone never activates — only report DB truth.
  return json(
    {
      state,
      tenant: {
        id: tenant.id,
        slug: tenant.slug,
        name: tenant.name,
        active: tenant.active === true,
        provisioning_state:
          typeof tenant.provisioning_state === "string"
            ? tenant.provisioning_state
            : null,
      },
      subscription: subscription
        ? {
            status: subscription.status,
            provider: subscription.provider,
          }
        : null,
    },
    200
  );
}
