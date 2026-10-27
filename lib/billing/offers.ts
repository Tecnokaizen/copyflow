import "server-only";

import type Stripe from "stripe";

import { createAdminClient } from "@/lib/supabase/admin";
import { checkOfferCoupon, type CouponCheck } from "@/lib/billing/offer-coupon";
import {
  computeOfferTerms,
  isOfferUsable,
  parseBillingOffers,
  type BillingOffer,
  type OfferTerms,
} from "@/lib/billing/offer-terms";

export const OFFER_UNAVAILABLE_CODE = "offer_unavailable";
export const OFFER_TERMS_CHANGED_CODE = "offer_terms_changed";

/** Usable offers of a tenant in one Stripe mode (active, before redeem_by). */
export async function listUsableTenantOffers(input: {
  tenantId: string;
  livemode: boolean;
  now?: Date;
}): Promise<BillingOffer[]> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("list_tenant_billing_offers_v1", {
    p_tenant_id: input.tenantId,
    p_livemode: input.livemode,
    p_include_inactive: false,
  });
  if (error) {
    throw new Error(`Failed to list billing offers: ${error.message}`);
  }
  const now = input.now ?? new Date();
  return parseBillingOffers(data).filter(
    (offer) =>
      offer.tenantId === input.tenantId &&
      offer.livemode === input.livemode &&
      isOfferUsable(offer, now)
  );
}

export type AcceptedOffer = { offer: BillingOffer; terms: OfferTerms };

export type AcceptOfferResult =
  | { ok: true; accepted: AcceptedOffer }
  | {
      ok: false;
      code:
        | typeof OFFER_UNAVAILABLE_CODE
        | typeof OFFER_TERMS_CHANGED_CODE
        | "owner_required";
    };

/**
 * The owner accepts the terms they were shown: the hash they send must match
 * the terms computed now. Acceptance is recorded before Checkout is created.
 */
export async function acceptOfferForCheckout(input: {
  tenantId: string;
  userId: string;
  planCode: string;
  offerId: string;
  termsHash: string;
  livemode: boolean;
  now?: Date;
}): Promise<AcceptOfferResult> {
  const now = input.now ?? new Date();
  const offers = await listUsableTenantOffers({
    tenantId: input.tenantId,
    livemode: input.livemode,
    now,
  });
  const offer = offers.find(
    (item) => item.offerId === input.offerId && item.planCode === input.planCode
  );
  if (!offer) {
    return { ok: false, code: OFFER_UNAVAILABLE_CODE };
  }

  const terms = computeOfferTerms(offer);
  if (terms.hash !== input.termsHash) {
    return { ok: false, code: OFFER_TERMS_CHANGED_CODE };
  }

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("accept_tenant_billing_offer_v1", {
    p_offer_id: offer.offerId,
    p_tenant_id: input.tenantId,
    p_user_id: input.userId,
    p_terms_hash: terms.hash,
  });
  if (error) {
    throw new Error(`Failed to accept billing offer: ${error.message}`);
  }
  const record =
    data && typeof data === "object" && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : {};
  if (record.outcome !== "accepted") {
    return {
      ok: false,
      code: record.reason === "owner_required" ? "owner_required" : OFFER_UNAVAILABLE_CODE,
    };
  }
  return { ok: true, accepted: { offer, terms } };
}

/** Retrieve the coupon from Stripe and check it against the offer. */
export async function verifyOfferCoupon(input: {
  stripe: Stripe;
  offer: BillingOffer;
  productId: string;
  sessionExpiresAtUnix: number;
}): Promise<CouponCheck> {
  const coupon = await input.stripe.coupons.retrieve(input.offer.providerCouponId, {
    expand: ["applies_to"],
  });
  return checkOfferCoupon({
    coupon: {
      id: coupon.id,
      livemode: coupon.livemode,
      valid: coupon.valid,
      amount_off: coupon.amount_off,
      percent_off: coupon.percent_off,
      currency: coupon.currency,
      duration: coupon.duration,
      duration_in_months: coupon.duration_in_months,
      max_redemptions: coupon.max_redemptions,
      times_redeemed: coupon.times_redeemed,
      redeem_by: coupon.redeem_by,
      applies_to: coupon.applies_to ?? null,
    },
    offer: input.offer,
    productId: input.productId,
    sessionExpiresAtUnix: input.sessionExpiresAtUnix,
  });
}

export type RedeemOfferOutcome =
  | "redeemed"
  | "unchanged"
  | "rejected"
  | "error";

/** Webhook: mark the offer used by a completed Checkout. Idempotent. */
export async function redeemTenantOffer(input: {
  offerId: string;
  tenantId: string;
  livemode: boolean;
  checkoutSessionId: string;
  providerSubscriptionId: string;
}): Promise<{ outcome: RedeemOfferOutcome; reason?: string }> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("redeem_tenant_billing_offer_v1", {
    p_offer_id: input.offerId,
    p_tenant_id: input.tenantId,
    p_livemode: input.livemode,
    p_checkout_session_id: input.checkoutSessionId,
    p_provider_subscription_id: input.providerSubscriptionId,
  });
  if (error) {
    console.error("[billing.offers] redeem_tenant_billing_offer_v1 failed", {
      message: error.message,
      code: error.code,
    });
    return { outcome: "error" };
  }
  const record =
    data && typeof data === "object" && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : {};
  if (record.outcome === "redeemed" || record.outcome === "unchanged") {
    return { outcome: record.outcome };
  }
  return {
    outcome: "rejected",
    reason: typeof record.reason === "string" ? record.reason : undefined,
  };
}
