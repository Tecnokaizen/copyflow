/**
 * Offer contracting path regression (app side). Same state as
 * supabase/tests/phase65_offer_contracting_path.sql, which covers the RPCs:
 * an internal trial still 'trialing' and ready_for_checkout whose period has
 * already ended, plus one active UNANCHORED Pro offer (40 € × 2 months,
 * redeem_by = deadline + 45 min, promo_ends_before = deadline + 2 months +
 * 45 min). This is the Production state of SUR4 between 02/11/2026 and its
 * deadline, 16/11/2026 20:00 in Madrid. Synthetic ids only; no tenant
 * exception exists in code, so the fixture is generic.
 *
 * Any change to Checkout, onboarding, plans, entitlements or the Billing
 * Access Gate must keep this file and phase65 green.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { hasCurrentNonStripeSubscription } from "./internal-subscription";
import { checkOfferCoupon, type CouponLike } from "./offer-coupon";
import {
  computeOfferTerms,
  isOfferUsable,
  offerCalendarIsCoherent,
  offerCheckoutExpiresAtUnix,
  offerContractDeadline,
  parseBillingOffers,
  type BillingOffer,
} from "./offer-terms";

const root = path.join(import.meta.dirname, "../..");
const read = (relative: string) => readFileSync(path.join(root, relative), "utf8");

const OFFER_ID = "65000000-0000-4000-8000-0000000000c1";
const TENANT_ID = "65000000-0000-4000-8000-000000000001";
// 16/11/2026 20:00 in Madrid (CET, UTC+1).
const DEADLINE = "2026-11-16T19:00:00.000Z";
const REDEEM_BY = "2026-11-16T19:45:00.000Z";
const PROMO_ENDS_BEFORE = "2027-01-16T19:45:00.000Z";
// Internal trial ended before the offer window (02/11/2026 13:53:09 UTC).
const TRIAL_END = "2026-11-02T13:53:09.000Z";

const unix = (iso: string) => Math.floor(Date.parse(iso) / 1000);
// Intl es-ES puts U+00A0 before "€"; compare with plain spaces.
const plain = (lines: string[]) => lines.join("\n").replace(/ /g, " ");

function offer(overrides: Record<string, unknown> = {}): BillingOffer {
  const [parsed] = parseBillingOffers([
    {
      offer_id: OFFER_ID,
      tenant_id: TENANT_ID,
      plan_code: "pro",
      plan_name: "Gestcopy Pro",
      plan_price_monthly: 79.0,
      plan_currency: "EUR",
      livemode: true,
      provider_coupon_id: "phase65-pro-39",
      discount_amount: 4000,
      currency: "eur",
      discount_months: 2,
      billing_cycle_anchor: null,
      promo_ends_before: PROMO_ENDS_BEFORE,
      redeem_by: REDEEM_BY,
      terms_version: "phase65-pro-39-v1",
      status: "active",
      accepted_at: null,
      ...overrides,
    },
  ]);
  assert.ok(parsed, "fixture offer must parse");
  return parsed;
}

describe("contracting path: internal trial past its end, ready_for_checkout", () => {
  const internal = {
    provider: "internal",
    status: "trialing",
    current_period_end: TRIAL_END,
    metadata: { billing_activation: "ready_for_checkout" },
  };

  it("does not block Checkout (hasCurrentNonStripeSubscription is false)", () => {
    assert.equal(hasCurrentNonStripeSubscription([internal]), false);
  });

  it("control: the same row without ready_for_checkout blocks Checkout", () => {
    for (const metadata of [
      {},
      null,
      { billing_activation: "deferred_until_go_live" },
      { billing_activation: "internal_pilot" },
    ]) {
      assert.equal(
        hasCurrentNonStripeSubscription([{ ...internal, metadata }]),
        true,
        JSON.stringify(metadata)
      );
    }
  });

  it("decides on status and metadata only, never on the period end", () => {
    const future = { ...internal, current_period_end: "2027-01-01T00:00:00.000Z" };
    assert.equal(hasCurrentNonStripeSubscription([future]), false);
    const blockedPast = { ...internal, metadata: {} };
    assert.equal(hasCurrentNonStripeSubscription([blockedPast]), true);
  });
});

describe("contracting path: unanchored Pro offer until the deadline", () => {
  it("has a coherent calendar and the deadline is redeem_by − 45 min", () => {
    const o = offer();
    assert.equal(o.billingCycleAnchor, null);
    assert.equal(offerCalendarIsCoherent(o), true);
    assert.equal(offerContractDeadline(o), DEADLINE);
    assert.equal(Date.parse(REDEEM_BY) - Date.parse(DEADLINE), 45 * 60 * 1000);
    assert.equal(computeOfferTerms(o).contractDeadline, DEADLINE);
  });

  it("shows 39,00 € charged at payment, then 79,00 €, until 16/11 20:00 Madrid", () => {
    const terms = computeOfferTerms(offer());
    assert.equal(terms.anchored, false);
    assert.equal(terms.discountedAmountMinor, 3900);
    assert.equal(terms.regularAmountMinor, 7900);
    const text = plain(terms.lines);
    assert.match(text, /Primer cobro, al confirmar el pago: 39,00 €\./);
    assert.match(text, /Segundo cobro, un mes después: 39,00 €\./);
    assert.match(text, /Desde el tercer mes: 79,00 € al mes/);
    assert.match(
      text,
      /Oferta válida para contratar hasta el 16 de noviembre de 2026 a las 20:00 \(hora de Madrid\)\./
    );
    assert.doesNotMatch(text, /Hoy no se cobra nada/);
  });

  it("is usable today and until the deadline, not after", () => {
    const o = offer();
    // Unanchored: no 27-day lead limit.
    assert.equal(isOfferUsable(o, new Date("2026-11-02T22:00:00Z")), true);
    assert.equal(isOfferUsable(o, new Date("2026-11-16T18:59:59Z")), true);
    assert.equal(isOfferUsable(o, new Date(DEADLINE)), false);
    assert.equal(isOfferUsable(o, new Date("2026-11-17T09:00:00Z")), false);
    assert.equal(isOfferUsable(offer({ status: "redeemed" }), new Date("2026-11-10T10:00:00Z")), false);
  });

  it("Checkout sessions close 10 minutes before redeem_by", () => {
    const terms = computeOfferTerms(offer());
    const reserved = unix("2026-11-17T09:00:00Z");
    assert.equal(
      offerCheckoutExpiresAtUnix({
        terms,
        reservedExpiresAtUnix: reserved,
        nowMs: Date.parse("2026-11-16T10:00:00Z"),
      }),
      unix("2026-11-16T19:35:00Z")
    );
    // Too late for a 30-minute Stripe session.
    assert.equal(
      offerCheckoutExpiresAtUnix({
        terms,
        reservedExpiresAtUnix: reserved,
        nowMs: Date.parse("2026-11-16T19:10:00Z"),
      }),
      null
    );
  });
});

describe("contracting path: coupon check against the session expiry", () => {
  const o = offer();
  const sessionExpiresAtUnix = unix("2026-11-16T19:35:00Z");
  const coupon: CouponLike = {
    id: "phase65-pro-39",
    livemode: true,
    valid: true,
    amount_off: 4000,
    percent_off: null,
    currency: "eur",
    duration: "repeating",
    duration_in_months: 2,
    max_redemptions: 1,
    times_redeemed: 0,
    redeem_by: unix(REDEEM_BY),
    applies_to: { products: ["prod_pro"] },
  };
  const check = (patch: Partial<CouponLike>) =>
    checkOfferCoupon({ coupon: { ...coupon, ...patch }, offer: o, productId: "prod_pro", sessionExpiresAtUnix });

  it("accepts the coupon whose redeem_by is after the session expiry", () => {
    assert.deepEqual(check({}), { ok: true });
  });

  it("rejects a coupon whose redeem_by is before (or at) the session expiry", () => {
    for (const redeemBy of [
      sessionExpiresAtUnix - 60,
      sessionExpiresAtUnix,
      unix("2026-11-02T22:59:59Z"),
    ]) {
      assert.deepEqual(
        check({ redeem_by: redeemBy }),
        { ok: false, reason: "coupon_redeem_by_too_early" },
        String(redeemBy)
      );
    }
  });
});

describe("contracting path: wiring", () => {
  it("Checkout checks internal subscriptions before the prepare RPC", () => {
    const checkout = read("lib/billing/checkout.ts");
    const guard = checkout.indexOf("tenantHasCurrentNonStripeSubscription(input.tenantId)");
    const prepare = checkout.indexOf("prepareCheckoutAttempt({");
    assert.ok(guard > 0 && prepare > guard);
  });

  it("the app guard has no date filter and no tenant exception", () => {
    const source = read("lib/billing/current-subscription.ts");
    assert.doesNotMatch(source, /current_period_end/);
    for (const file of [
      "lib/billing/current-subscription.ts",
      "lib/billing/internal-subscription.ts",
      "lib/billing/offer-terms.ts",
      "lib/billing/offer-coupon.ts",
      "lib/billing/offers.ts",
      "lib/billing/checkout.ts",
    ]) {
      assert.equal(/\bsur4\b/i.test(read(file).replace(/\/\/.*|\/\*[\s\S]*?\*\//g, "")), false, file);
    }
  });

  it("runs phase65 in the always-on release gate", () => {
    const workflow = read(".github/workflows/release-gate.yml");
    assert.match(workflow, /^\s+phase65_offer_contracting_path(?: \\)?$/m);
  });
});
