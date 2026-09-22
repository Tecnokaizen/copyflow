import "server-only";

import { NextRequest } from "next/server";

import { resolveStripeCustomerIdForTenant } from "@/lib/billing/customer";
import { parseCheckoutRequest } from "@/lib/billing/checkout-parse";
import {
  CHECKOUT_PROCESSING_CODE,
  attachCheckoutSession,
  prepareCheckoutAttempt,
  resolveReusableCheckoutSession,
} from "@/lib/billing/checkout-attempts";
import { reservedExpiresAtUnix } from "@/lib/billing/checkout-attempts-keys";
import { resolveStripePrice } from "@/lib/billing/resolve-price";
import { getStripe } from "@/lib/billing/stripe";
import type {
  BillingIntervalAllowed,
  BillingPlanCode,
} from "@/lib/billing/access";
import { CURRENT_SUBSCRIPTION_EXISTS_CODE } from "@/lib/billing/webhook-errors";
import {
  resolveTrustedAppOrigin,
  resolveTrustedTenantOrigin,
} from "@/lib/tenant/request-origin";

export { parseCheckoutRequest };
export { CURRENT_SUBSCRIPTION_EXISTS_CODE };
export { CHECKOUT_PROCESSING_CODE };

export class CheckoutConflictError extends Error {
  readonly code = CURRENT_SUBSCRIPTION_EXISTS_CODE;

  constructor() {
    super("Current Stripe subscription already exists");
    this.name = "CheckoutConflictError";
  }
}

export class CheckoutProcessingError extends Error {
  readonly code = CHECKOUT_PROCESSING_CODE;

  constructor() {
    super("Checkout completed; subscription sync in progress");
    this.name = "CheckoutProcessingError";
  }
}

export class CheckoutTransientError extends Error {
  readonly retryable = true;

  constructor(message = "Checkout provider temporarily unavailable") {
    super(message);
    this.name = "CheckoutTransientError";
  }
}

/** @deprecated Prefer resolveTrustedAppOrigin — kept for onboarding call sites. */
export function appHostOriginFromRequest(request: NextRequest): string {
  return resolveTrustedAppOrigin(request);
}

async function createStripeCheckoutForAttempt(input: {
  request: NextRequest;
  tenantId: string;
  tenantSlug: string;
  planCode: BillingPlanCode;
  billingInterval: BillingIntervalAllowed;
  customerEmail?: string | null;
  successUrl?: string;
  cancelUrl?: string;
  attemptId: string;
  idempotencyKey: string;
  expiresAt: string;
}): Promise<{ url: string; sessionId: string }> {
  const price = await resolveStripePrice({
    planCode: input.planCode,
    interval: input.billingInterval,
  });

  const stripe = getStripe();
  const existingCustomerId = await resolveStripeCustomerIdForTenant(
    input.tenantId
  );
  const origin = resolveTrustedTenantOrigin(input.request, input.tenantSlug);
  const successUrl =
    input.successUrl ??
    `${origin}/settings/billing/success?session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl =
    input.cancelUrl ?? `${origin}/settings/billing?canceled=1`;
  const expiresAtUnix = reservedExpiresAtUnix(input.expiresAt);

  const session = await stripe.checkout.sessions.create(
    {
      mode: "subscription",
      line_items: [{ price: price.providerPriceId, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      client_reference_id: input.tenantId,
      expires_at: expiresAtUnix,
      ...(existingCustomerId
        ? { customer: existingCustomerId }
        : input.customerEmail
          ? { customer_email: input.customerEmail }
          : {}),
      metadata: {
        tenant_id: input.tenantId,
        plan_code: input.planCode,
        checkout_attempt_id: input.attemptId,
      },
      subscription_data: {
        metadata: {
          tenant_id: input.tenantId,
          plan_code: input.planCode,
        },
      },
    },
    { idempotencyKey: input.idempotencyKey }
  );

  if (!session.url) {
    throw new Error("Stripe Checkout Session missing url");
  }

  await attachCheckoutSession({
    attemptId: input.attemptId,
    sessionId: session.id,
    // Reserved DB expiry is authoritative; Stripe should match via idempotency.
    expiresAt: new Date(expiresAtUnix * 1000),
  });

  return { url: session.url, sessionId: session.id };
}

/**
 * Reserve a DB attempt under advisory lock, then create Stripe Checkout with
 * attempt-scoped idempotency. Concurrent callers share one usable session.
 */
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
  flow?: "billing" | "onboarding";
}): Promise<{ url: string; sessionId: string }> {
  // Up to two prepare passes: first may expire an open Stripe session.
  for (let pass = 0; pass < 2; pass += 1) {
    const prepared = await prepareCheckoutAttempt({
      tenantId: input.tenantId,
      planCode: input.planCode,
      billingInterval: input.billingInterval,
      flow: input.flow ?? "billing",
    });

    if (prepared.outcome === "current_subscription_exists") {
      throw new CheckoutConflictError();
    }

    if (prepared.outcome === "checkout_processing") {
      throw new CheckoutProcessingError();
    }

    if (prepared.outcome === "reuse") {
      const resolved = await resolveReusableCheckoutSession({
        attemptId: prepared.attemptId,
        sessionId: prepared.sessionId,
      });

      if (resolved.kind === "open") {
        return { url: resolved.url, sessionId: resolved.sessionId };
      }

      if (resolved.kind === "processing") {
        throw new CheckoutProcessingError();
      }

      if (resolved.kind === "retryable") {
        throw new CheckoutTransientError(
          "Could not verify existing Checkout Session"
        );
      }

      // Explicitly expired (or canceled) locally — prepare again for a new attempt.
      continue;
    }

    // reserved
    return createStripeCheckoutForAttempt({
      ...input,
      attemptId: prepared.attemptId,
      idempotencyKey: prepared.idempotencyKey,
      expiresAt: prepared.expiresAt,
    });
  }

  throw new CheckoutTransientError("Could not reserve a Checkout attempt");
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
  const origin = resolveTrustedTenantOrigin(input.request, input.tenantSlug);

  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${origin}/settings/billing`,
  });

  return { url: session.url };
}
