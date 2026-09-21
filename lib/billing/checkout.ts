import "server-only";

import { NextRequest } from "next/server";

import { resolveStripeCustomerIdForTenant } from "@/lib/billing/customer";
import { parseCheckoutRequest } from "@/lib/billing/checkout-parse";
import { resolveStripePrice } from "@/lib/billing/resolve-price";
import { getStripe } from "@/lib/billing/stripe";
import type {
  BillingIntervalAllowed,
  BillingPlanCode,
} from "@/lib/billing/access";
import { tenantOrigin } from "@/lib/tenant/domains";

export { parseCheckoutRequest };

function requestOrigin(request: NextRequest, tenantSlug: string): string {
  const host =
    request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (host) {
    const proto = request.headers.get("x-forwarded-proto") ?? "https";
    return `${proto}://${host.split(",")[0]!.trim()}`;
  }
  return tenantOrigin(tenantSlug);
}

export async function createCheckoutSessionForTenant(input: {
  request: NextRequest;
  tenantId: string;
  tenantSlug: string;
  planCode: BillingPlanCode;
  billingInterval: BillingIntervalAllowed;
  customerEmail?: string | null;
}): Promise<{ url: string; sessionId: string }> {
  const price = await resolveStripePrice({
    planCode: input.planCode,
    interval: input.billingInterval,
  });

  const stripe = getStripe();
  const existingCustomerId = await resolveStripeCustomerIdForTenant(
    input.tenantId
  );
  const origin = requestOrigin(input.request, input.tenantSlug);

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: price.providerPriceId, quantity: 1 }],
    success_url: `${origin}/settings/billing/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/settings/billing?canceled=1`,
    client_reference_id: input.tenantId,
    ...(existingCustomerId
      ? { customer: existingCustomerId }
      : input.customerEmail
        ? { customer_email: input.customerEmail }
        : {}),
    metadata: {
      tenant_id: input.tenantId,
      plan_code: input.planCode,
    },
    subscription_data: {
      metadata: {
        tenant_id: input.tenantId,
        plan_code: input.planCode,
      },
    },
  });

  if (!session.url) {
    throw new Error("Stripe Checkout Session missing url");
  }

  return { url: session.url, sessionId: session.id };
}

export async function createPortalSessionForTenant(input: {
  request: NextRequest;
  tenantId: string;
  tenantSlug: string;
}): Promise<{ url: string }> {
  const customerId = await resolveStripeCustomerIdForTenant(input.tenantId);
  if (!customerId) {
    throw new Error("missing_stripe_customer");
  }

  const stripe = getStripe();
  const origin = requestOrigin(input.request, input.tenantSlug);

  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${origin}/settings/billing`,
  });

  return { url: session.url };
}
