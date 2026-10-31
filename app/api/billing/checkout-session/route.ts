import { NextRequest, NextResponse } from "next/server";

import { canManageBilling } from "@/lib/billing/access";
import {
  CHECKOUT_PROCESSING_CODE,
  CheckoutConflictError,
  CheckoutInternalSubscriptionError,
  CheckoutPendingReconciliationError,
  CheckoutProcessingError,
  CheckoutTransientError,
  CheckoutOfferUnavailableError,
  CURRENT_SUBSCRIPTION_EXISTS_CODE,
  INTERNAL_SUBSCRIPTION_CURRENT_CODE,
  SUBSCRIPTION_PENDING_RECONCILIATION_CODE,
  createCheckoutSessionForTenant,
  parseCheckoutRequest,
} from "@/lib/billing/checkout";
import {
  OFFER_UNAVAILABLE_CODE,
  acceptOfferForCheckout,
  type AcceptedOffer,
} from "@/lib/billing/offers";
import {
  assertStripeConfig,
  stripeModeToLivemode,
} from "@/lib/billing/stripe-config";
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
    return json(
      parsed.code ? { error: parsed.error, code: parsed.code } : { error: parsed.error },
      parsed.code ? 403 : 400
    );
  }

  try {
    // Offer Checkout: the owner accepts the terms shown (hash), recorded now.
    let offer: AcceptedOffer | null = null;
    if (parsed.offer) {
      const accepted = await acceptOfferForCheckout({
        tenantId: context.tenant.id,
        userId: context.user.id,
        planCode: parsed.planCode,
        offerId: parsed.offer.offerId,
        termsHash: parsed.offer.termsHash,
        livemode: stripeModeToLivemode(stripeConfig.mode),
      });
      if (!accepted.ok) {
        return json(
          { error: "The offer is not available with these terms", code: accepted.code },
          409
        );
      }
      offer = accepted.accepted;
    }

    const session = await createCheckoutSessionForTenant({
      request,
      tenantId: context.tenant.id,
      tenantSlug: context.tenant.slug,
      planCode: parsed.planCode,
      billingInterval: parsed.billingInterval,
      customerEmail: context.user.email,
      flow: "billing",
      offer,
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
    if (error instanceof CheckoutInternalSubscriptionError) {
      return json(
        {
          error: "Current internal subscription blocks checkout",
          code: INTERNAL_SUBSCRIPTION_CURRENT_CODE,
        },
        409
      );
    }
    if (error instanceof CheckoutPendingReconciliationError) {
      return json(
        {
          error: "A Stripe subscription is pending reconciliation",
          code: SUBSCRIPTION_PENDING_RECONCILIATION_CODE,
        },
        409
      );
    }
    if (error instanceof CheckoutProcessingError) {
      return json(
        {
          error: "Checkout completed; subscription confirmation in progress",
          code: CHECKOUT_PROCESSING_CODE,
        },
        409
      );
    }
    if (error instanceof CheckoutOfferUnavailableError) {
      return json(
        { error: "The offer cannot be used right now", code: OFFER_UNAVAILABLE_CODE },
        409
      );
    }
    if (error instanceof CheckoutTransientError) {
      return json(
        {
          error: "Checkout temporarily unavailable",
          code: "checkout_transient",
        },
        503
      );
    }
    console.error("[POST /api/billing/checkout-session] failed", {
      message: error instanceof Error ? error.message : "unknown",
    });
    return json({ error: "Could not create checkout session" }, 500);
  }
}
