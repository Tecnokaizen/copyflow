import { NextRequest, NextResponse } from "next/server";

import { getStripe } from "@/lib/billing/stripe";
import { assertStripeConfig } from "@/lib/billing/stripe-config";
import { isQualifyingActivationStatus } from "@/lib/onboarding/pending-tenant";
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

function tenantIdFromCheckoutSession(session: {
  client_reference_id?: string | null;
  metadata?: Record<string, string> | null;
}): string | null {
  const fromRef = session.client_reference_id?.trim();
  if (fromRef) {
    return fromRef;
  }
  const fromMeta = session.metadata?.tenant_id?.trim();
  return fromMeta || null;
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

  const tenantId = tenantIdFromCheckoutSession(stripeSession);
  if (!tenantId) {
    return json({ error: "Checkout session missing tenant reference" }, 400);
  }

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
  const { data: tenant, error: tenantError } = await admin
    .from("tenants")
    .select("id, slug, name, active")
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
    .in("status", ["trialing", "active", "past_due", "incomplete", "unpaid", "canceled", "paused"])
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const paymentStatus = stripeSession.payment_status;
  const sessionStatus = stripeSession.status;

  let state: "awaiting_payment" | "processing" | "active" | "failed" =
    "processing";

  if (tenant.active === true) {
    state = "active";
  } else if (sessionStatus === "expired") {
    state = "failed";
  } else if (sessionStatus === "open") {
    state = "awaiting_payment";
  } else if (
    subscription &&
    typeof subscription.status === "string" &&
    [
      "incomplete",
      "incomplete_expired",
      "unpaid",
      "canceled",
      "paused",
    ].includes(subscription.status)
  ) {
    state = "failed";
  } else if (
    paymentStatus === "paid" ||
    sessionStatus === "complete" ||
    (subscription &&
      isQualifyingActivationStatus(
        typeof subscription.status === "string" ? subscription.status : null
      ))
  ) {
    // Checkout may be complete while webhook activation is still pending.
    state = "processing";
  } else {
    state = "awaiting_payment";
  }

  // session_id alone never activates — only report DB truth.
  return json(
    {
      state,
      tenant: {
        id: tenant.id,
        slug: tenant.slug,
        name: tenant.name,
        active: tenant.active === true,
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
