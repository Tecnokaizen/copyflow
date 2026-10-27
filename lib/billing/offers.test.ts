/**
 * Commercial plans Basic/Pro and tenant billing offers
 * (20261028090000_commercial_plans_pro_offers_v1.sql): terms shown before
 * payment, Checkout timing, coupon checks, session reuse, request parsing,
 * Portal configuration and the static wiring of Checkout and the webhook.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import {
  isBillingPlanCode,
  isSelfServePlanCode,
  PRO_STORAGE_BYTES,
} from "./access";
import { checkoutSessionMatches } from "./checkout-attempts-keys";
import { parseCheckoutRequest } from "./checkout-parse";
import { checkOfferCoupon, type CouponLike } from "./offer-coupon";
import {
  addMonthsUtc,
  computeOfferTerms,
  isOfferUsable,
  offerCheckoutExpiresAtUnix,
  parseBillingOffers,
  type BillingOffer,
} from "./offer-terms";
import { portalConfigurationForPlan } from "./stripe-config";

const root = path.join(import.meta.dirname, "../..");
const read = (relative: string) => readFileSync(path.join(root, relative), "utf8");

const MIGRATION = "supabase/migrations/20261028090000_commercial_plans_pro_offers_v1.sql";
const ROLLBACK = "supabase/rollbacks/20261028090000_commercial_plans_pro_offers_v1.sql";

const OFFER_ID = "6f1c2a7e-0b7d-4c55-9a51-3c1f8b2d9e10";
const TENANT_ID = "1b0c7f3e-8a2d-4e6f-9c1b-2d3e4f5a6b7c";
// SUR4: internal trial ends 02/11/2026 13:53:09 UTC; the coupon can be
// redeemed until the end of 02/01/2027 in Madrid.
const ANCHOR = "2026-11-02T13:53:09.000Z";
const REDEEM_BY = "2027-01-02T22:59:59.000Z";

function rpcRow(overrides: Record<string, unknown> = {}) {
  return {
    offer_id: OFFER_ID,
    tenant_id: TENANT_ID,
    plan_code: "pro",
    plan_name: "Gestcopy Pro",
    plan_price_monthly: 79.0,
    plan_currency: "EUR",
    livemode: true,
    provider_coupon_id: "gestcopy-sur4-pro-39",
    discount_amount: 4000,
    currency: "eur",
    discount_months: 2,
    billing_cycle_anchor: ANCHOR,
    promo_ends_before: "2027-01-02T13:53:09+00:00",
    redeem_by: REDEEM_BY,
    terms_version: "sur4-pro-39-v1",
    status: "active",
    accepted_at: null,
    ...overrides,
  };
}

function sur4Offer(overrides: Record<string, unknown> = {}): BillingOffer {
  const [offer] = parseBillingOffers([rpcRow(overrides)]);
  assert.ok(offer, "fixture offer must parse");
  return offer;
}

describe("plans: Basic self-serve, Pro by offer only", () => {
  it("knows both plans and sells only Basic without an offer", () => {
    assert.equal(isBillingPlanCode("basic"), true);
    assert.equal(isBillingPlanCode("pro"), true);
    assert.equal(isBillingPlanCode("pro_early_access"), false);
    assert.equal(isSelfServePlanCode("basic"), true);
    assert.equal(isSelfServePlanCode("pro"), false);
    assert.equal(PRO_STORAGE_BYTES, 50 * 1024 ** 3);
  });
});

describe("offer payload", () => {
  it("parses the RPC rows and drops malformed ones", () => {
    const offers = parseBillingOffers([
      rpcRow(),
      rpcRow({ discount_amount: 7900 }),
      rpcRow({ currency: "usd" }),
      rpcRow({ discount_months: 0 }),
      rpcRow({ offer_id: "not-a-uuid" }),
      rpcRow({ status: "pending" }),
      "junk",
    ]);
    assert.equal(offers.length, 1);
    assert.equal(offers[0].planPriceMinor, 7900);
    assert.equal(offers[0].discountAmountMinor, 4000);
    assert.equal(offers[0].billingCycleAnchor, ANCHOR);
    assert.deepEqual(parseBillingOffers(null), []);
  });

  it("adds Stripe-like months (same day, clamped at month end)", () => {
    assert.equal(addMonthsUtc(ANCHOR, 1), "2026-12-02T13:53:09.000Z");
    assert.equal(addMonthsUtc(ANCHOR, 2), "2027-01-02T13:53:09.000Z");
    assert.equal(addMonthsUtc("2027-01-31T10:00:00.000Z", 1), "2027-02-28T10:00:00.000Z");
  });
});

describe("SUR4 offer terms", () => {
  it("anchored: nothing today, 39 € on 02/11 and 02/12, 79 € from 02/01/2027", () => {
    const terms = computeOfferTerms(sur4Offer(), new Date("2026-10-28T10:00:00Z"));
    assert.equal(terms.anchored, true);
    assert.equal(terms.anchorAt, ANCHOR);
    assert.equal(terms.regularAmountMinor, 7900);
    assert.equal(terms.discountedAmountMinor, 3900);
    assert.deepEqual(
      terms.discountedCharges.map((charge) => [charge.at, charge.amountMinor]),
      [
        ["2026-11-02T13:53:09.000Z", 3900],
        ["2026-12-02T13:53:09.000Z", 3900],
      ]
    );
    assert.equal(terms.firstRegularChargeAt, "2027-01-02T13:53:09.000Z");
    const text = terms.lines.join("\n").replace(/\u00a0/g, " ");
    assert.match(text, /Plan: Gestcopy Pro, 79,00 € al mes\./);
    assert.match(text, /40,00 € de descuento en cada una de las 2 primeras cuotas/);
    assert.match(text, /Hoy no se cobra nada\./);
    assert.match(text, /Primer cobro: 39,00 € el 2 de noviembre de 2026\./);
    assert.match(text, /Segundo cobro: 39,00 € el 2 de diciembre de 2026\./);
    assert.match(text, /A partir del 2 de enero de 2027: 79,00 € al mes, salvo que antes cambies de plan o canceles/);
    assert.match(text, /hasta el 2 de enero de 2027\./);
    assert.doesNotMatch(text, /IA|voz|early/i);
    assert.match(terms.hash, /^[0-9a-f]{64}$/);
  });

  it("the hash is stable for the same terms and changes when they change", () => {
    const a = computeOfferTerms(sur4Offer(), new Date("2026-10-28T10:00:00Z"));
    const b = computeOfferTerms(sur4Offer(), new Date("2026-10-30T18:00:00Z"));
    assert.equal(a.hash, b.hash);
    const late = computeOfferTerms(sur4Offer(), new Date("2026-11-02T13:30:00Z"));
    assert.equal(late.anchored, false);
    assert.notEqual(late.hash, a.hash);
    const other = computeOfferTerms(sur4Offer({ terms_version: "sur4-pro-39-v2" }), new Date("2026-10-28T10:00:00Z"));
    assert.notEqual(other.hash, a.hash);
  });

  it("not anchored after the trial end: two discounted charges from payment", () => {
    const terms = computeOfferTerms(sur4Offer(), new Date("2026-11-05T09:00:00Z"));
    assert.equal(terms.anchored, false);
    assert.equal(terms.firstRegularChargeAt, null);
    const text = terms.lines.join("\n").replace(/\u00a0/g, " ");
    assert.match(text, /Primer cobro, al confirmar el pago: 39,00 €\./);
    assert.match(text, /Segundo cobro, un mes después: 39,00 €\./);
    assert.match(text, /Desde el tercer mes: 79,00 € al mes/);
    assert.doesNotMatch(text, /Hoy no se cobra nada/);
  });

  it("never anchors more than a month ahead (the discount would end early)", () => {
    const terms = computeOfferTerms(sur4Offer(), new Date("2026-10-01T10:00:00Z"));
    assert.equal(terms.anchored, false);
  });

  it("is usable until shortly before redeem_by", () => {
    const offer = sur4Offer();
    assert.equal(isOfferUsable(offer, new Date("2027-01-02T20:00:00Z")), true);
    assert.equal(isOfferUsable(offer, new Date("2027-01-02T22:30:00Z")), false);
    assert.equal(isOfferUsable(sur4Offer({ status: "redeemed" }), new Date("2026-10-28T10:00:00Z")), false);
  });
});

describe("offer Checkout timing", () => {
  const reserved = Math.floor(Date.parse("2026-11-03T09:00:00Z") / 1000);

  it("closes the session 10 minutes before the anchor", () => {
    const now = new Date("2026-11-02T08:00:00Z");
    const terms = computeOfferTerms(sur4Offer(), now);
    assert.equal(
      offerCheckoutExpiresAtUnix({ terms, reservedExpiresAtUnix: reserved, nowMs: now.getTime() }),
      Math.floor(Date.parse("2026-11-02T13:43:09Z") / 1000)
    );
  });

  it("keeps the reserved expiry when the anchor is far", () => {
    const now = new Date("2026-10-28T10:00:00Z");
    const terms = computeOfferTerms(sur4Offer(), now);
    const early = Math.floor(Date.parse("2026-10-29T09:30:00Z") / 1000);
    assert.equal(
      offerCheckoutExpiresAtUnix({ terms, reservedExpiresAtUnix: early, nowMs: now.getTime() }),
      early
    );
  });

  it("refuses a session that could not live 30 minutes before redeem_by", () => {
    const now = new Date("2027-01-02T22:25:00Z");
    const terms = computeOfferTerms(sur4Offer(), now);
    assert.equal(
      offerCheckoutExpiresAtUnix({
        terms,
        reservedExpiresAtUnix: Math.floor(Date.parse("2027-01-03T21:55:00Z") / 1000),
        nowMs: now.getTime(),
      }),
      null
    );
  });
});

describe("offer coupon check (fail closed)", () => {
  const offer = sur4Offer();
  const sessionExpiresAtUnix = Math.floor(Date.parse("2026-11-02T13:43:09Z") / 1000);
  const good: CouponLike = {
    id: "gestcopy-sur4-pro-39",
    livemode: true,
    valid: true,
    amount_off: 4000,
    percent_off: null,
    currency: "eur",
    duration: "repeating",
    duration_in_months: 2,
    max_redemptions: 1,
    times_redeemed: 0,
    redeem_by: Math.floor(Date.parse(REDEEM_BY) / 1000),
    applies_to: { products: ["prod_pro"] },
  };
  const check = (coupon: Partial<CouponLike>) =>
    checkOfferCoupon({
      coupon: { ...good, ...coupon },
      offer,
      productId: "prod_pro",
      sessionExpiresAtUnix,
    });

  it("accepts the coupon that matches the offer", () => {
    assert.deepEqual(check({}), { ok: true });
  });

  it("rejects every difference", () => {
    const cases: Array<[Partial<CouponLike>, string]> = [
      [{ livemode: false }, "coupon_mode_mismatch"],
      [{ valid: false }, "coupon_invalid"],
      [{ id: "other" }, "coupon_invalid"],
      [{ amount_off: 3900 }, "coupon_amount_mismatch"],
      [{ amount_off: null, percent_off: 50 }, "coupon_amount_mismatch"],
      [{ currency: "usd" }, "coupon_amount_mismatch"],
      [{ duration: "forever", duration_in_months: null }, "coupon_duration_mismatch"],
      [{ duration_in_months: 3 }, "coupon_duration_mismatch"],
      [{ applies_to: null }, "coupon_not_restricted"],
      [{ applies_to: { products: ["prod_basic"] } }, "coupon_not_restricted"],
      [{ applies_to: { products: ["prod_pro", "prod_basic"] } }, "coupon_not_restricted"],
      [{ max_redemptions: null }, "coupon_not_single_use"],
      [{ max_redemptions: 5 }, "coupon_not_single_use"],
      [{ times_redeemed: 1 }, "coupon_not_single_use"],
      [{ redeem_by: sessionExpiresAtUnix }, "coupon_redeem_by_too_early"],
    ];
    for (const [coupon, reason] of cases) {
      assert.deepEqual(check(coupon), { ok: false, reason }, JSON.stringify(coupon));
    }
  });
});

describe("Checkout Session reuse", () => {
  it("reuses only a session for the same plan, offer and terms", () => {
    const basic = { planCode: "basic", offerId: null, termsHash: null };
    const pro = { planCode: "pro", offerId: OFFER_ID, termsHash: "a".repeat(64) };
    assert.equal(checkoutSessionMatches({ plan_code: "basic", tenant_id: TENANT_ID }, basic), true);
    assert.equal(checkoutSessionMatches({ plan_code: "basic" }, pro), false);
    assert.equal(
      checkoutSessionMatches({ plan_code: "pro", offer_id: OFFER_ID, offer_terms_hash: "a".repeat(64) }, pro),
      true
    );
    assert.equal(
      checkoutSessionMatches({ plan_code: "pro", offer_id: OFFER_ID, offer_terms_hash: "b".repeat(64) }, pro),
      false
    );
    assert.equal(checkoutSessionMatches({ plan_code: "pro", offer_id: OFFER_ID }, basic), false);
    assert.equal(checkoutSessionMatches(null, basic), false);
  });
});

describe("checkout request", () => {
  const hash = "c".repeat(64);

  it("keeps Basic self-serve and requires an offer for Pro", () => {
    assert.deepEqual(parseCheckoutRequest({ plan_code: "basic", billing_interval: "month" }), {
      ok: true,
      planCode: "basic",
      billingInterval: "month",
      offer: null,
    });
    assert.deepEqual(parseCheckoutRequest({ plan_code: "pro", billing_interval: "month" }), {
      ok: false,
      error: "This plan is only available with an offer",
      code: "offer_required",
    });
  });

  it("accepts an offer with its terms hash only", () => {
    const parsed = parseCheckoutRequest({
      plan_code: "pro",
      billing_interval: "month",
      offer_id: OFFER_ID.toUpperCase(),
      terms_hash: hash,
    });
    assert.ok(parsed.ok);
    assert.deepEqual(parsed.offer, { offerId: OFFER_ID, termsHash: hash });
    for (const body of [
      { plan_code: "pro", billing_interval: "month", offer_id: OFFER_ID },
      { plan_code: "pro", billing_interval: "month", terms_hash: hash },
      { plan_code: "pro", billing_interval: "month", offer_id: "x", terms_hash: hash },
      { plan_code: "pro", billing_interval: "month", offer_id: OFFER_ID, terms_hash: "XYZ" },
      { plan_code: "pro", billing_interval: "month", offer_id: OFFER_ID, terms_hash: hash, coupon: "free" },
      { plan_code: "pro", billing_interval: "year", offer_id: OFFER_ID, terms_hash: hash },
    ]) {
      assert.equal(parseCheckoutRequest(body).ok, false, JSON.stringify(body));
    }
  });
});

describe("Customer Portal configuration", () => {
  it("lets only Pro subscribers switch plans, from a configured bpc_ id", () => {
    const env = { STRIPE_PORTAL_CONFIGURATION_PLAN_CHANGE: " bpc_123ABC " };
    assert.equal(portalConfigurationForPlan("pro", env), "bpc_123ABC");
    assert.equal(portalConfigurationForPlan("basic", env), undefined);
    assert.equal(portalConfigurationForPlan(null, env), undefined);
    assert.equal(portalConfigurationForPlan("pro", {}), undefined);
    assert.equal(
      portalConfigurationForPlan("pro", { STRIPE_PORTAL_CONFIGURATION_PLAN_CHANGE: "https://x" }),
      undefined
    );
  });
});

describe("wiring", () => {
  it("Checkout carries the coupon, the terms and the anchor without proration", () => {
    const checkout = read("lib/billing/checkout.ts");
    assert.match(checkout, /discounts: \[\{ coupon: offer\.offer\.providerCouponId \}\]/);
    assert.match(checkout, /billing_cycle_anchor: anchorUnix, proration_behavior: "none"/);
    assert.match(checkout, /submit: \{ message: offerSubmitMessage\(offer\.terms\.lines\) \}/);
    assert.match(checkout, /offer_id: offer\.offer\.offerId, offer_terms_hash: offer\.terms\.hash/);
    assert.match(checkout, /verifyOfferCoupon\(/);
    assert.match(checkout, /!offer && !isSelfServePlanCode\(input\.planCode\)/);
    assert.doesNotMatch(checkout, /allow_promotion_codes/);
  });

  it("the route records acceptance before creating Checkout", () => {
    const route = read("app/api/billing/checkout-session/route.ts");
    const accept = route.indexOf("acceptOfferForCheckout(");
    const create = route.indexOf("createCheckoutSessionForTenant({");
    assert.ok(accept > 0 && create > accept);
    assert.match(route, /userId: context\.user\.id/);
  });

  it("the webhook redeems the offer after the sync, idempotently", () => {
    const webhook = read("lib/billing/webhook.ts");
    assert.match(webhook, /redeemOfferAfterCheckout\(\{/);
    assert.match(webhook, /redeemTenantOffer\(\{/);
    assert.match(webhook, /errorCode: "offer_redeem_failed", retryable: true/);
  });

  it("onboarding stays on Basic without offers", () => {
    const onboarding = read("app/api/onboarding/route.ts");
    assert.match(onboarding, /planCode: "basic"/);
    assert.doesNotMatch(onboarding, /offer/);
  });
});

describe("migration and rollback", () => {
  it("adds Pro with a fixed id and no AI or early access", () => {
    const sql = read(MIGRATION);
    assert.match(sql, /'30000000-0000-4000-8000-000000000003',\s*'pro',\s*'Gestcopy Pro'/);
    assert.match(sql, /79\.00/);
    assert.match(sql, /53687091200/);
    assert.equal(sql.includes("pro_early_access"), false);
    assert.equal(sql.includes("ai_voice_orders"), false);
    assert.equal(/\bsur4\b/i.test(sql), false, "no tenant named in the migration");
    assert.doesNotMatch(sql, /update public\.subscriptions|insert into public\.subscriptions/);
    assert.doesNotMatch(sql, /tenant_feature_overrides/);
  });

  it("keeps offers service-only under the tenant billing lock", () => {
    const sql = read(MIGRATION);
    for (const fn of [
      "grant_tenant_billing_offer_v1",
      "revoke_tenant_billing_offer_v1",
      "list_tenant_billing_offers_v1",
      "accept_tenant_billing_offer_v1",
      "redeem_tenant_billing_offer_v1",
    ]) {
      assert.match(sql, new RegExp(`revoke all on function public\\.${fn}\\([\\s\\S]*?\\)\\s+from public, anon, authenticated;`));
    }
    assert.equal((sql.match(/hashtextextended\(p_tenant_id::text, 31\)/g) ?? []).length, 3);
    assert.match(sql, /hashtextextended\(v_offer\.tenant_id::text, 31\)/);
    assert.match(sql, /revoke all on table billing_private\.tenant_billing_offers\s+from public, anon, authenticated, service_role;/);
  });

  it("the rollback refuses while anyone pays Pro and keeps the offers", () => {
    const sql = read(ROLLBACK);
    assert.match(sql, /rollback refused: subscriptions on plan pro exist/);
    assert.doesNotMatch(sql, /drop table/);
    assert.doesNotMatch(sql, /delete from public\.billing_prices/);
  });

  it("runs phase60 in the always-on release gate", () => {
    const workflow = read(".github/workflows/release-gate.yml");
    assert.match(workflow, /^\s+phase60_commercial_plans_pro$/m);
  });
});
