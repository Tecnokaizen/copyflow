import { NextRequest, NextResponse } from "next/server";

import { canManageBilling } from "@/lib/billing/access";
import { createPortalSessionForTenant } from "@/lib/billing/checkout";
import { assertStripeConfig } from "@/lib/billing/stripe-config";
import { getCurrentContext } from "@/lib/tenant/current-context";

const NO_STORE = {
  "Cache-Control": "private, no-store, max-age=0, must-revalidate",
} as const;

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

export async function POST(request: NextRequest) {
  const context = await getCurrentContext();
  if (!context || !canManageBilling(context.membership.role)) {
    return json({ error: "Unauthorized or tenant access denied" }, 403);
  }

  const stripeConfig = assertStripeConfig();
  if (!stripeConfig.ok) {
    return json({ error: "Billing is not configured" }, 503);
  }

  try {
    const session = await createPortalSessionForTenant({
      request,
      tenantId: context.tenant.id,
      tenantSlug: context.tenant.slug,
    });
    return json({ url: session.url }, 200);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    if (message === "missing_stripe_customer") {
      return json({ error: "No Stripe customer for this tenant" }, 409);
    }
    console.error("[POST /api/billing/portal-session] failed", { message });
    return json({ error: "Could not create portal session" }, 500);
  }
}
