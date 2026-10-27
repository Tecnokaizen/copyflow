/**
 * Tenant billing offers (20261028090000): parse the RPC payload and compute
 * the terms shown before payment. Pure, no Stripe or Supabase access.
 *
 * The coupon is `amount_off` on the plan price, `duration: repeating` for
 * `discount_months`. Stripe starts the discount when the subscription is
 * created and does not discount an invoice dated exactly at its end.
 *
 * Calendar rule (owner decision D1, 28/10/2026): no promotional period goes
 * past promo_ends_before; from that date the regular price applies unless the
 * customer changed plan or cancelled before. An offer never adjusts itself:
 *   - anchored (billing_cycle_anchor set): fixed dates. Nothing is charged
 *     until the anchor (no proration), the discounted charges fall on the
 *     anchor and the following months, and anchor + discount_months must be
 *     exactly promo_ends_before (the first regular charge). Usable only while
 *     the anchor is 45 minutes to 27 days away; later it closes, it never
 *     falls back to charges counted from the payment.
 *   - not anchored: discounted charges from the payment date; usable only
 *     while payment + discount_months still ends by promo_ends_before.
 * A shorter calendar needs a new offer granted by an operator.
 * Verified with Stripe test clocks (docs/BILLING-PRO-OFFERS-V1.md).
 */
import { createHash } from "node:crypto";

export type BillingOfferStatus = "active" | "redeemed" | "revoked";

export type BillingOffer = {
  offerId: string;
  tenantId: string;
  planCode: string;
  planName: string;
  /** Plan monthly price in minor units (cents). */
  planPriceMinor: number;
  livemode: boolean;
  providerCouponId: string;
  discountAmountMinor: number;
  /** Lowercase ISO currency, e.g. "eur". */
  currency: string;
  discountMonths: number;
  billingCycleAnchor: string | null;
  promoEndsBefore: string;
  redeemBy: string;
  termsVersion: string;
  status: BillingOfferStatus;
  acceptedAt: string | null;
};

/**
 * The anchor (or the last valid payment time) must leave time to pay: a
 * Checkout Session lives at least 30 minutes and closes 10 minutes before.
 */
export const ANCHOR_MIN_LEAD_MS = 45 * 60 * 1000;
/** Created more than a month before the anchor, the discount would end early. */
export const ANCHOR_MAX_LEAD_MS = 27 * 24 * 60 * 60 * 1000;
/** A Checkout Session must close before the anchor and before redeem_by. */
export const OFFER_SESSION_MARGIN_MS = 10 * 60 * 1000;
/** Stripe: expires_at at least 30 minutes after creation. */
export const STRIPE_CHECKOUT_MIN_LIFETIME_MS = 30 * 60 * 1000;

const ISO_CURRENCY = /^[a-z]{3}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function asIso(value: unknown): string | null {
  if (typeof value !== "string" || !value) {
    return null;
  }
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function asInt(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isInteger(n) ? n : null;
}

function priceToMinor(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0) {
    return null;
  }
  return Math.round(n * 100);
}

/** Parse list_tenant_billing_offers_v1. Malformed rows are dropped. */
export function parseBillingOffers(data: unknown): BillingOffer[] {
  if (!Array.isArray(data)) {
    return [];
  }
  const offers: BillingOffer[] = [];
  for (const item of data) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }
    const r = item as Record<string, unknown>;
    const planPriceMinor = priceToMinor(r.plan_price_monthly);
    const discountAmountMinor = asInt(r.discount_amount);
    const discountMonths = asInt(r.discount_months);
    const promoEndsBefore = asIso(r.promo_ends_before);
    const redeemBy = asIso(r.redeem_by);
    const currency =
      typeof r.currency === "string" ? r.currency.toLowerCase() : "";
    const planCurrency =
      typeof r.plan_currency === "string" ? r.plan_currency.toLowerCase() : "";
    const status = r.status;
    if (
      typeof r.offer_id !== "string" ||
      !UUID.test(r.offer_id) ||
      typeof r.tenant_id !== "string" ||
      typeof r.plan_code !== "string" ||
      typeof r.plan_name !== "string" ||
      typeof r.provider_coupon_id !== "string" ||
      typeof r.terms_version !== "string" ||
      typeof r.livemode !== "boolean" ||
      planPriceMinor === null ||
      discountAmountMinor === null ||
      discountAmountMinor <= 0 ||
      discountAmountMinor >= planPriceMinor ||
      discountMonths === null ||
      discountMonths < 1 ||
      discountMonths > 12 ||
      !ISO_CURRENCY.test(currency) ||
      currency !== planCurrency ||
      !promoEndsBefore ||
      !redeemBy ||
      (status !== "active" && status !== "redeemed" && status !== "revoked")
    ) {
      continue;
    }
    offers.push({
      offerId: r.offer_id.toLowerCase(),
      tenantId: r.tenant_id,
      planCode: r.plan_code,
      planName: r.plan_name,
      planPriceMinor,
      livemode: r.livemode,
      providerCouponId: r.provider_coupon_id,
      discountAmountMinor,
      currency,
      discountMonths,
      billingCycleAnchor: asIso(r.billing_cycle_anchor),
      promoEndsBefore,
      redeemBy,
      termsVersion: r.terms_version,
      status,
      acceptedAt: asIso(r.accepted_at),
    });
  }
  return offers;
}

/** Stripe monthly cycle: same UTC day and time, clamped to the month end. */
export function addMonthsUtc(iso: string, months: number): string {
  const d = new Date(iso);
  const day = d.getUTCDate();
  const target = new Date(
    Date.UTC(
      d.getUTCFullYear(),
      d.getUTCMonth() + months,
      1,
      d.getUTCHours(),
      d.getUTCMinutes(),
      d.getUTCSeconds()
    )
  );
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)
  ).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target.toISOString();
}

export function formatOfferMoney(minor: number, currency: string): string {
  return new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(minor / 100);
}

export function formatOfferDate(iso: string): string {
  return new Intl.DateTimeFormat("es-ES", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Madrid",
  }).format(new Date(iso));
}

export function formatOfferDateTime(iso: string): string {
  const time = new Intl.DateTimeFormat("es-ES", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "Europe/Madrid",
  }).format(new Date(iso));
  return `${formatOfferDate(iso)} a las ${time} (hora de Madrid)`;
}

export type OfferCharge = {
  /** null: charged when the payment is confirmed (or N months later). */
  at: string | null;
  amountMinor: number;
};

export type OfferTerms = {
  offerId: string;
  planCode: string;
  planName: string;
  currency: string;
  regularAmountMinor: number;
  discountAmountMinor: number;
  discountedAmountMinor: number;
  discountMonths: number;
  anchored: boolean;
  /** Billing cycle anchor used in Checkout, when anchored. */
  anchorAt: string | null;
  discountedCharges: OfferCharge[];
  firstRegularChargeAt: string | null;
  redeemBy: string;
  /** Last moment to start the Checkout with this offer (see offerContractDeadline). */
  contractDeadline: string;
  termsVersion: string;
  lines: string[];
  /** sha256 hex of the terms; the owner accepts exactly this. */
  hash: string;
};

export function offerIsAnchored(offer: BillingOffer): boolean {
  return offer.billingCycleAnchor !== null;
}

/**
 * Anchored: anchor + discount_months is exactly promo_ends_before.
 * Not anchored: always true (the deadline keeps it inside the promotion).
 */
export function offerCalendarIsCoherent(offer: BillingOffer): boolean {
  if (!offer.billingCycleAnchor) {
    return true;
  }
  return (
    Date.parse(addMonthsUtc(offer.billingCycleAnchor, offer.discountMonths)) ===
    Date.parse(offer.promoEndsBefore)
  );
}

/**
 * Last moment to start a Checkout with the offer: 45 minutes before the
 * earliest of redeem_by and the calendar limit (the anchor, or for an offer
 * without anchor the last payment time that still ends the discounted months
 * by promo_ends_before).
 */
export function offerContractDeadline(offer: BillingOffer): string {
  const calendarLimit = offer.billingCycleAnchor
    ? Date.parse(offer.billingCycleAnchor)
    : Date.parse(addMonthsUtc(offer.promoEndsBefore, -offer.discountMonths));
  const limit = Math.min(Date.parse(offer.redeemBy), calendarLimit);
  return new Date(limit - ANCHOR_MIN_LEAD_MS).toISOString();
}

function ordinal(n: number): string {
  return (
    ["primer", "segundo", "tercer", "cuarto", "quinto", "sexto"][n - 1] ??
    `${n}.º`
  );
}

function chargeLabel(n: number): string {
  const word = ordinal(n);
  return `${word[0].toUpperCase()}${word.slice(1)} cobro`;
}

/** The terms depend on the offer only, never on the current time. */
export function computeOfferTerms(offer: BillingOffer): OfferTerms {
  const regular = offer.planPriceMinor;
  const discounted = regular - offer.discountAmountMinor;
  const anchored = offerIsAnchored(offer);
  const anchorAt = anchored ? offer.billingCycleAnchor : null;
  const contractDeadline = offerContractDeadline(offer);
  const money = (minor: number) => formatOfferMoney(minor, offer.currency);

  const discountedCharges: OfferCharge[] = [];
  for (let k = 0; k < offer.discountMonths; k += 1) {
    discountedCharges.push({
      at: anchorAt ? addMonthsUtc(anchorAt, k) : null,
      amountMinor: discounted,
    });
  }
  const firstRegularChargeAt = anchorAt
    ? addMonthsUtc(anchorAt, offer.discountMonths)
    : null;

  const lines: string[] = [
    `Plan: ${offer.planName}, ${money(regular)} al mes.`,
    offer.discountMonths === 1
      ? `Oferta para esta organización: ${money(offer.discountAmountMinor)} de descuento en la primera cuota mensual.`
      : `Oferta para esta organización: ${money(offer.discountAmountMinor)} de descuento en cada una de las ${offer.discountMonths} primeras cuotas mensuales.`,
  ];
  if (anchorAt) {
    lines.push("Hoy no se cobra nada.");
    discountedCharges.forEach((charge, index) => {
      lines.push(
        `${chargeLabel(index + 1)}: ${money(charge.amountMinor)} el ${formatOfferDate(charge.at as string)}.`
      );
    });
    lines.push(
      `A partir del ${formatOfferDate(firstRegularChargeAt as string)}: ${money(regular)} al mes, salvo que antes cambies de plan o canceles desde «Gestionar suscripción».`
    );
  } else {
    lines.push(`${chargeLabel(1)}, al confirmar el pago: ${money(discounted)}.`);
    for (let k = 1; k < offer.discountMonths; k += 1) {
      lines.push(
        `${chargeLabel(k + 1)}, ${k === 1 ? "un mes" : `${k} meses`} después: ${money(discounted)}.`
      );
    }
    lines.push(
      `Desde el ${ordinal(offer.discountMonths + 1)} mes: ${money(regular)} al mes, salvo que antes cambies de plan o canceles desde «Gestionar suscripción».`
    );
  }
  lines.push(`Oferta válida para contratar hasta el ${formatOfferDateTime(contractDeadline)}.`);

  const hash = createHash("sha256")
    .update(
      JSON.stringify({
        v: offer.termsVersion,
        offer: offer.offerId,
        plan: offer.planCode,
        currency: offer.currency,
        regular,
        discount: offer.discountAmountMinor,
        months: offer.discountMonths,
        anchor: anchorAt,
        promo_ends_before: offer.promoEndsBefore,
        redeem_by: offer.redeemBy,
        deadline: contractDeadline,
        lines,
      })
    )
    .digest("hex");

  return {
    offerId: offer.offerId,
    planCode: offer.planCode,
    planName: offer.planName,
    currency: offer.currency,
    regularAmountMinor: regular,
    discountAmountMinor: offer.discountAmountMinor,
    discountedAmountMinor: discounted,
    discountMonths: offer.discountMonths,
    anchored,
    anchorAt,
    discountedCharges,
    firstRegularChargeAt,
    redeemBy: offer.redeemBy,
    contractDeadline,
    termsVersion: offer.termsVersion,
    lines,
    hash,
  };
}

/**
 * Stripe Checkout expires_at for an offer session: the reserved attempt
 * expiry, capped 10 minutes before the calendar limit (the anchor, or the
 * last valid payment time) and before redeem_by. Depends on fixed values
 * only, so an idempotent retry sends the same parameters. null when the
 * session could not live the Stripe minimum (the offer window closed).
 */
export function offerCheckoutExpiresAtUnix(input: {
  terms: OfferTerms;
  reservedExpiresAtUnix: number;
  nowMs: number;
}): number | null {
  const limitMs =
    Date.parse(input.terms.contractDeadline) + ANCHOR_MIN_LEAD_MS - OFFER_SESSION_MARGIN_MS;
  const capMs = Math.min(input.reservedExpiresAtUnix * 1000, limitMs);
  if (capMs < input.nowMs + STRIPE_CHECKOUT_MIN_LIFETIME_MS) {
    return null;
  }
  return Math.floor(capMs / 1000);
}

/**
 * Usable now: active, coherent calendar, before the contract deadline and,
 * when anchored, no more than 27 days before the anchor (an earlier
 * subscription would end the discount before the last discounted charge).
 */
export function isOfferUsable(offer: BillingOffer, now: Date): boolean {
  if (offer.status !== "active" || !offerCalendarIsCoherent(offer)) {
    return false;
  }
  const nowMs = now.getTime();
  if (
    offer.billingCycleAnchor &&
    Date.parse(offer.billingCycleAnchor) - nowMs > ANCHOR_MAX_LEAD_MS
  ) {
    return false;
  }
  return nowMs < Date.parse(offerContractDeadline(offer));
}
