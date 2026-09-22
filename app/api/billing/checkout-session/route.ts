import { NextRequest, NextResponse } from "next/server";

import { canManageBilling } from "@/lib/billing/access";
import {
  CheckoutConflictError,
  CURRENT_SUBSCRIPTION_EXISTS_CODE,
  createCheckoutSessionForTenant,
  parseCheckoutRequest,
} from "@/lib/billing/checkout";
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const parsed = parseCheckoutRequest(body);
  if (!parsed.ok) {
    return json({ error: parsed.error }, 400);
  }

  try {
    const session = await createCheckoutSessionForTenant({
      request,
      tenantId: context.tenant.id,
      tenantSlug: context.tenant.slug,
      planCode: parsed.planCode,
      billingInterval: parsed.billingInterval,
      customerEmail: context.user.email,
    });

    return json({ url: session.url, session_id: session.sessionId }, 200);
  } catch (error) {
    if (error instanceof CheckoutConflictError) {
      return json(
        {
          error: "Current subscription already exists",
          code: CURRENT_SUBSCRIPTION_EXISTS_CODE,
        },
        409
      );
    }
    console.error("[POST /api/billing/checkout-session] failed", {
      message: error instanceof Error ? error.message : "unknown",
    });
    return json({ error: "Could not create checkout session" }, 500);
  }
}
