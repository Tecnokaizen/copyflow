import "server-only";

import { NextRequest } from "next/server";

import { resolveStripeCustomerIdForTenant } from "@/lib/billing/customer";
import { parseCheckoutRequest } from "@/lib/billing/checkout-parse";
import {
  prepareCheckoutAttempt,
  registerCheckoutAttempt,
  resolveReusableCheckoutSession,
} from "@/lib/billing/checkout-attempts";
import {
  CURRENT_SUBSCRIPTION_EXISTS_CODE,
  tenantHasCurrentStripeSubscription,
} from "@/lib/billing/current-subscription";
import { resolveStripePrice } from "@/lib/billing/resolve-price";
import { getStripe } from "@/lib/billing/stripe";
import type {
  BillingIntervalAllowed,
  BillingPlanCode,
} from "@/lib/billing/access";
import { CURRENT_SUBSCRIPTION_EXISTS_CODE as CONFLICT_CODE } from "@/lib/billing/webhook-errors";
import { tenantOrigin } from "@/lib/tenant/domains";

export { parseCheckoutRequest };
export { CURRENT_SUBSCRIPTION_EXISTS_CODE };

export class CheckoutConflictError extends Error {
  readonly code = CONFLICT_CODE;

  constructor() {
    super("Current Stripe subscription already exists");
    this.name = "CheckoutConflictError";
  }
}

function requestOrigin(request: NextRequest, tenantSlug: string): string {
  const host =
    request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (host) {
    const proto = request.headers.get("x-forwarded-proto") ?? "https";
    return `${proto}://${host.split(",")[0]!.trim()}`;
  }
  return tenantOrigin(tenantSlug);
}

/** App-host origin from the current request (no tenant slug fallback). */
export function appHostOriginFromRequest(request: NextRequest): string | null {
  const host =
    request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!host) {
    return null;
  }
  const proto = request.headers.get("x-forwarded-proto") ?? "https";
  return `${proto}://${host.split(",")[0]!.trim()}`;
}

function sessionExpiresAt(expiresAt: number | null | undefined): Date {
  if (typeof expiresAt === "number" && Number.isFinite(expiresAt)) {
    return new Date(expiresAt * 1000);
  }
  // Stripe Checkout Sessions expire after ~24h by default.
  return new Date(Date.now() + 24 * 60 * 60 * 1000);
}

export async function createCheckoutSessionForTenant(input: {
  request: NextRequest;
  tenantId: string;
  tenantSlug: string;
  planCode: BillingPlanCode;
  billingInterval: BillingIntervalAllowed;
  customerEmail?: string | null;
  /** Absolute or request-relative success URL template (may include {CHECKOUT_SESSION_ID}). */
  successUrl?: string;
  /** Absolute cancel URL. */
  cancelUrl?: string;
}): Promise<{ url: string; sessionId: string }> {
  if (await tenantHasCurrentStripeSubscription(input.tenantId)) {
    throw new CheckoutConflictError();
  }

  const prepared = await prepareCheckoutAttempt(input.tenantId);
  if (prepared.outcome === "reuse") {
    const reused = await resolveReusableCheckoutSession(prepared.sessionId);
    if (reused.ok) {
      return { url: reused.url, sessionId: reused.sessionId };
    }
    // Expired/canceled locally finalized — fall through to create.
  }

  const price = await resolveStripePrice({
    planCode: input.planCode,
    interval: input.billingInterval,
  });

  const stripe = getStripe();
  const existingCustomerId = await resolveStripeCustomerIdForTenant(
    input.tenantId
  );
  const origin = requestOrigin(input.request, input.tenantSlug);
  const successUrl =
    input.successUrl ??
    `${origin}/settings/billing/success?session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl =
    input.cancelUrl ?? `${origin}/settings/billing?canceled=1`;

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: price.providerPriceId, quantity: 1 }],
    success_url: successUrl,
    cancel_url: cancelUrl,
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

  const registered = await registerCheckoutAttempt({
    tenantId: input.tenantId,
    sessionId: session.id,
    expiresAt: sessionExpiresAt(session.expires_at),
    planCode: input.planCode,
    billingInterval: input.billingInterval,
  });

  if (registered.outcome === "reuse" && registered.sessionId !== session.id) {
    // Lost the race — prefer the winning open session.
    try {
      await stripe.checkout.sessions.expire(session.id);
    } catch {
      // best-effort
    }
    const winner = await resolveReusableCheckoutSession(registered.sessionId);
    if (winner.ok) {
      return { url: winner.url, sessionId: winner.sessionId };
    }
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
