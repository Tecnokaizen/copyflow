/**
 * Checks a Stripe coupon against a tenant billing offer before it is put in
 * a Checkout Session. Pure: the caller retrieves the coupon (expanded
 * applies_to). Fail closed: any difference blocks the offer.
 */
import type { BillingOffer } from "@/lib/billing/offer-terms";

export type CouponLike = {
  id: string;
  livemode: boolean;
  valid: boolean;
  amount_off: number | null;
  percent_off: number | null;
  currency: string | null;
  duration: string;
  duration_in_months: number | null;
  max_redemptions: number | null;
  times_redeemed: number;
  redeem_by: number | null;
  applies_to?: { products: string[] } | null;
};

export type CouponCheck =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "coupon_mode_mismatch"
        | "coupon_invalid"
        | "coupon_amount_mismatch"
        | "coupon_duration_mismatch"
        | "coupon_not_restricted"
        | "coupon_not_single_use"
        | "coupon_redeem_by_too_early";
    };

export function checkOfferCoupon(input: {
  coupon: CouponLike;
  offer: BillingOffer;
  /** Stripe product of the price the Checkout Session sells. */
  productId: string;
  /** The Checkout Session closes at this time (unix seconds). */
  sessionExpiresAtUnix: number;
}): CouponCheck {
  const { coupon, offer } = input;
  if (coupon.livemode !== offer.livemode) {
    return { ok: false, reason: "coupon_mode_mismatch" };
  }
  if (!coupon.valid || coupon.id !== offer.providerCouponId) {
    return { ok: false, reason: "coupon_invalid" };
  }
  if (
    coupon.percent_off !== null ||
    coupon.amount_off !== offer.discountAmountMinor ||
    (coupon.currency ?? "").toLowerCase() !== offer.currency
  ) {
    return { ok: false, reason: "coupon_amount_mismatch" };
  }
  if (
    coupon.duration !== "repeating" ||
    coupon.duration_in_months !== offer.discountMonths
  ) {
    return { ok: false, reason: "coupon_duration_mismatch" };
  }
  const products = coupon.applies_to?.products ?? [];
  if (products.length !== 1 || products[0] !== input.productId) {
    return { ok: false, reason: "coupon_not_restricted" };
  }
  if (
    coupon.max_redemptions !== 1 ||
    coupon.times_redeemed >= coupon.max_redemptions
  ) {
    return { ok: false, reason: "coupon_not_single_use" };
  }
  if (coupon.redeem_by !== null && coupon.redeem_by <= input.sessionExpiresAtUnix) {
    return { ok: false, reason: "coupon_redeem_by_too_early" };
  }
  return { ok: true };
}
