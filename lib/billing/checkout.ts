import "server-only";

import { billingReturnUrls } from "@/lib/billing/return-urls";

import { NextRequest } from "next/server";

import { resolveStripeCustomerIdForTenant } from "@/lib/billing/customer";
import { parseCheckoutRequest } from "@/lib/billing/checkout-parse";
import {
  CHECKOUT_MODE_MISMATCH_CODE,
  CHECKOUT_PROCESSING_CODE,
  CheckoutModeMismatchError,
  attachCheckoutSession,
  prepareCheckoutAttempt,
  resolveReusableCheckoutSession,
} from "@/lib/billing/checkout-attempts";
import { reservedExpiresAtUnix } from "@/lib/billing/checkout-attempts-keys";
import {
  INTERNAL_SUBSCRIPTION_CURRENT_CODE,
  tenantHasCurrentNonStripeSubscription,
} from "@/lib/billing/current-subscription";
import { resolveStripePrice } from "@/lib/billing/resolve-price";
import { offerCheckoutExpiresAtUnix } from "@/lib/billing/offer-terms";
import {
  OFFER_UNAVAILABLE_CODE,
  verifyOfferCoupon,
  type AcceptedOffer,
} from "@/lib/billing/offers";
import { isSelfServePlanCode } from "@/lib/billing/access";
import { getStripe } from "@/lib/billing/stripe";
import {
  getStripeMode,
  portalConfigurationForPlan,
  stripeModeToLivemode,
} from "@/lib/billing/stripe-config";
import { createAdminClient } from "@/lib/supabase/admin";
import type {
  BillingIntervalAllowed,
  BillingPlanCode,
} from "@/lib/billing/access";
import { CURRENT_SUBSCRIPTION_EXISTS_CODE } from "@/lib/billing/webhook-errors";
import { resolveTrustedAppOrigin } from "@/lib/tenant/request-origin";

export { parseCheckoutRequest };
export { CURRENT_SUBSCRIPTION_EXISTS_CODE };
export { CHECKOUT_PROCESSING_CODE };
export { CHECKOUT_MODE_MISMATCH_CODE, CheckoutModeMismatchError };
export { INTERNAL_SUBSCRIPTION_CURRENT_CODE };

export class CheckoutConflictError extends Error {
  readonly code = CURRENT_SUBSCRIPTION_EXISTS_CODE;

  constructor() {
    super("Current Stripe subscription already exists");
    this.name = "CheckoutConflictError";
  }
}

export class CheckoutInternalSubscriptionError extends Error {
  readonly code = INTERNAL_SUBSCRIPTION_CURRENT_CODE;

  constructor() {
    super("Current internal subscription blocks Checkout");
    this.name = "CheckoutInternalSubscriptionError";
  }
}

export const SUBSCRIPTION_PENDING_RECONCILIATION_CODE =
  "subscription_pending_reconciliation";

export class CheckoutPendingReconciliationError extends Error {
  readonly code = SUBSCRIPTION_PENDING_RECONCILIATION_CODE;

  constructor() {
    super("A Stripe subscription is pending reconciliation");
    this.name = "CheckoutPendingReconciliationError";
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

export class CheckoutPriceModeMismatchError extends Error {
  readonly code = "price_mode_mismatch";

  constructor() {
    super("Stripe price livemode does not match STRIPE_MODE");
    this.name = "CheckoutPriceModeMismatchError";
  }
}

/**
 * The offer cannot be used in a Checkout now: its window closed (anchor or
 * redeem_by too close) or the Stripe coupon does not match the offer.
 */
export class CheckoutOfferUnavailableError extends Error {
  readonly code = OFFER_UNAVAILABLE_CODE;

  constructor(readonly reason: string) {
    super(`Billing offer unavailable: ${reason}`);
    this.name = "CheckoutOfferUnavailableError";
  }
}

/** Stripe Checkout custom text is limited to 1200 characters. */
export function offerSubmitMessage(lines: string[]): string {
  const text = lines.join(" ");
  return text.length <= 1200 ? text : `${text.slice(0, 1199)}…`;
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
  livemode: boolean;
  offer?: AcceptedOffer | null;
}): Promise<{ url: string; sessionId: string }> {
  const price = await resolveStripePrice({
    planCode: input.planCode,
    interval: input.billingInterval,
  });

  if (price.livemode !== input.livemode) {
    throw new CheckoutPriceModeMismatchError();
  }

  const stripe = getStripe();
  const offer = input.offer ?? null;
  let expiresAtUnix = reservedExpiresAtUnix(input.expiresAt);
  if (offer) {
    if (
      offer.offer.planCode !== input.planCode ||
      offer.offer.livemode !== input.livemode
    ) {
      throw new CheckoutOfferUnavailableError("offer_plan_or_mode_mismatch");
    }
    const capped = offerCheckoutExpiresAtUnix({
      terms: offer.terms,
      reservedExpiresAtUnix: expiresAtUnix,
      nowMs: Date.now(),
    });
    if (capped === null) {
      throw new CheckoutOfferUnavailableError("offer_window_closed");
    }
    expiresAtUnix = capped;
    const couponCheck = await verifyOfferCoupon({
      stripe,
      offer: offer.offer,
      productId: price.providerProductId,
      sessionExpiresAtUnix: expiresAtUnix,
    });
    if (!couponCheck.ok) {
      console.error("[billing.checkout] offer coupon check failed", {
        offerId: offer.offer.offerId,
        reason: couponCheck.reason,
      });
      throw new CheckoutOfferUnavailableError(couponCheck.reason);
    }
  }

  const existingCustomerId = await resolveStripeCustomerIdForTenant(
    input.tenantId,
    input.livemode
  );
  const returns = billingReturnUrls(input.request, input.tenantSlug);
  const successUrl =
    input.successUrl ??
    returns.successUrl;
  const cancelUrl =
    input.cancelUrl ?? returns.cancelUrl;

  // Offer: the coupon, the accepted terms on the payment page and, when the
  // terms are anchored, no charge until the anchor (no proration).
  const offerMetadata: Record<string, string> = offer
    ? { offer_id: offer.offer.offerId, offer_terms_hash: offer.terms.hash }
    : {};
  const anchorUnix =
    offer?.terms.anchorAt != null
      ? Math.floor(Date.parse(offer.terms.anchorAt) / 1000)
      : null;

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
      ...(offer
        ? {
            discounts: [{ coupon: offer.offer.providerCouponId }],
            custom_text: {
              submit: { message: offerSubmitMessage(offer.terms.lines) },
            },
          }
        : {}),
      metadata: {
        tenant_id: input.tenantId,
        plan_code: input.planCode,
        checkout_attempt_id: input.attemptId,
        ...offerMetadata,
      },
      subscription_data: {
        metadata: {
          tenant_id: input.tenantId,
          plan_code: input.planCode,
          ...offerMetadata,
        },
        ...(anchorUnix !== null
          ? { billing_cycle_anchor: anchorUnix, proration_behavior: "none" as const }
          : {}),
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
  /** Required for plans that are not self-serve (Pro). */
  offer?: AcceptedOffer | null;
}): Promise<{ url: string; sessionId: string }> {
  const returns = billingReturnUrls(input.request, input.tenantSlug);
  const returnUrls = {
    successUrl: input.successUrl ?? returns.successUrl,
    cancelUrl: input.cancelUrl ?? returns.cancelUrl,
  };
  const livemode = stripeModeToLivemode(getStripeMode());
  const offer = input.offer ?? null;

  if (!offer && !isSelfServePlanCode(input.planCode)) {
    throw new CheckoutOfferUnavailableError("offer_required");
  }

  // Internal trials/pilots are invisible to the prepare RPC (Stripe rows only).
  if (await tenantHasCurrentNonStripeSubscription(input.tenantId)) {
    throw new CheckoutInternalSubscriptionError();
  }

  // Up to two prepare passes: first may expire an open Stripe session.
  for (let pass = 0; pass < 2; pass += 1) {
    const prepared = await prepareCheckoutAttempt({
      tenantId: input.tenantId,
      planCode: input.planCode,
      billingInterval: input.billingInterval,
      flow: input.flow ?? "billing",
      livemode,
    });

    if (prepared.outcome === "current_subscription_exists") {
      throw new CheckoutConflictError();
    }

    if (prepared.outcome === "internal_subscription_current") {
      throw new CheckoutInternalSubscriptionError();
    }

    if (prepared.outcome === "subscription_pending_reconciliation") {
      throw new CheckoutPendingReconciliationError();
    }

    if (prepared.outcome === "checkout_processing") {
      throw new CheckoutProcessingError();
    }

    if (prepared.outcome === "reuse") {
      // An open session for another plan, offer or terms is expired, not reused.
      const resolved = await resolveReusableCheckoutSession({
        attemptId: prepared.attemptId,
        sessionId: prepared.sessionId,
        livemode,
        returnUrls,
        expected: {
          planCode: input.planCode,
          offerId: offer?.offer.offerId ?? null,
          termsHash: offer?.terms.hash ?? null,
        },
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
      livemode,
      offer,
    });
  }

  throw new CheckoutTransientError("Could not reserve a Checkout attempt");
}

export async function createPortalSessionForTenant(input: {
  request: NextRequest;
  tenantId: string;
  tenantSlug: string;
}): Promise<{ url: string }> {
  const returns = billingReturnUrls(input.request, input.tenantSlug);
  const customerId = await resolveStripeCustomerIdForTenant(input.tenantId);
  if (!customerId) {
    throw new Error("missing_stripe_customer");
  }

  const stripe = getStripe();
  const configuration = portalConfigurationForPlan(
    await currentStripePlanCode(input.tenantId)
  );

  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: returns.portalUrl,
    ...(configuration ? { configuration } : {}),
  });

  return { url: session.url };
}

/** Plan of the tenant's current Stripe subscription in STRIPE_MODE, if any. */
async function currentStripePlanCode(tenantId: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("subscriptions")
    .select("plans ( code )")
    .eq("tenant_id", tenantId)
    .eq("provider", "stripe")
    .eq("livemode", stripeModeToLivemode(getStripeMode()))
    .in("status", ["trialing", "active", "past_due"])
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) {
    throw new Error(`Failed to load current plan: ${error.message}`);
  }
  const plans = (data?.[0] as { plans?: { code?: string } | { code?: string }[] } | undefined)
    ?.plans;
  const plan = Array.isArray(plans) ? plans[0] : plans;
  return typeof plan?.code === "string" ? plan.code : null;
}
