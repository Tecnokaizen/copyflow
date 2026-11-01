/**
 * Operator tool for tenant billing offers (20261028090000). Dry-run unless
 * --confirm-test / --confirm-live matches STRIPE_MODE. Never prints secrets.
 *
 *   inspect --tenant <slug> [--coupon-id <id>]
 *   coupon  --coupon-id <id> --redeem-by <ISO> [--amount-off 4000] [--months 2] [--name <text>]
 *   grant   --tenant <slug> --coupon-id <id> --redeem-by <ISO> --promo-ends-before <ISO>
 *           [--anchor <ISO>] --terms-version <v> --reason <text> --authorized-by <who>
 *           [--amount-off 4000] [--months 2]
 *   revoke  --offer-id <uuid> --reason <text> --authorized-by <who>
 *   portal  (plan-change Customer Portal configuration: Pro ↔ Basic)
 *
 * Env: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_MODE,
 *      NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY).
 *
 * The coupon: amount_off on Pro, repeating N months, single use, restricted
 * to the Pro product, redeem_by. The offer row lets one tenant use it.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import Stripe from "stripe";

import {
  assertStripeConfig,
  getStripeMode,
  stripeModeToLivemode,
} from "../../lib/billing/stripe-config";
import { checkOfferCoupon } from "../../lib/billing/offer-coupon";
import {
  computeOfferTerms,
  isOfferUsable,
  offerCalendarIsCoherent,
  parseBillingOffers,
} from "../../lib/billing/offer-terms";

const PORTAL_MARKER = "plan_change_v1";

function flag(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
}

function has(name: string): boolean {
  return process.argv.includes(name);
}

function required(name: string): string {
  const value = flag(name)?.trim();
  if (!value) {
    throw new Error(`Missing ${name}`);
  }
  return value;
}

function isoArg(name: string, optional = false): string | null {
  const value = optional ? flag(name) : required(name);
  if (value == null) {
    return null;
  }
  const ms = Date.parse(value);
  if (!Number.isFinite(ms) || !/[zZ]|[+-]\d\d:\d\d$/.test(value)) {
    throw new Error(`${name} must be an ISO timestamp with a timezone`);
  }
  return new Date(ms).toISOString();
}

function intArg(name: string, fallback: number): number {
  const raw = flag(name);
  const value = raw == null ? fallback : Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function print(value: unknown) {
  console.log(JSON.stringify(value, null, 2));
}

type Ctx = {
  stripe: Stripe;
  admin: SupabaseClient;
  mode: "test" | "live";
  livemode: boolean;
  confirmed: boolean;
};

function context(): Ctx {
  const config = assertStripeConfig();
  if (!config.ok) {
    throw new Error(`Stripe config incomplete: ${config.reason}`);
  }
  const mode = getStripeMode();
  const confirmed =
    (mode === "test" && has("--confirm-test")) ||
    (mode === "live" && has("--confirm-live"));
  if (has("--confirm-live") && mode !== "live") {
    throw new Error("--confirm-live needs STRIPE_MODE=live");
  }
  if (has("--confirm-test") && mode !== "test") {
    throw new Error("--confirm-test needs STRIPE_MODE=test");
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key =
    process.env.SUPABASE_SECRET_KEY?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY");
  }
  return {
    stripe: new Stripe(config.secretKey, { apiVersion: "2026-08-26.dahlia" }),
    admin: createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    }),
    mode,
    livemode: stripeModeToLivemode(mode),
    confirmed,
  };
}

async function tenantBySlug(ctx: Ctx, slug: string) {
  const { data, error } = await ctx.admin
    .from("tenants")
    .select("id, slug, name, active")
    .eq("slug", slug)
    .maybeSingle();
  if (error || !data) {
    throw new Error(`Tenant ${slug} not found`);
  }
  return data as { id: string; slug: string; name: string; active: boolean };
}

async function planPrice(ctx: Ctx, planCode: "basic" | "pro") {
  const { data, error } = await ctx.admin
    .from("billing_prices")
    .select("provider_product_id, provider_price_id, unit_amount, plans!inner ( code )")
    .eq("provider", "stripe")
    .eq("billing_interval", "month")
    .eq("livemode", ctx.livemode)
    .eq("active", true)
    .eq("plans.code", planCode);
  if (error) {
    throw new Error(`billing_prices: ${error.message}`);
  }
  if (!data || data.length !== 1) {
    throw new Error(
      `Expected one active ${planCode} price in ${ctx.mode} mode, found ${data?.length ?? 0} (run bootstrap-stripe-catalog --plan ${planCode})`
    );
  }
  return data[0] as { provider_product_id: string; provider_price_id: string; unit_amount: number };
}

async function inspect(ctx: Ctx) {
  const tenant = await tenantBySlug(ctx, required("--tenant"));
  const { data: subs } = await ctx.admin
    .from("subscriptions")
    .select("status, provider, livemode, current_period_end, cancel_at_period_end, metadata, plans ( code )")
    .eq("tenant_id", tenant.id)
    .order("created_at", { ascending: false })
    .limit(10);
  const { data: offers, error } = await ctx.admin.rpc("list_tenant_billing_offers_v1", {
    p_tenant_id: tenant.id,
    p_livemode: ctx.livemode,
    p_include_inactive: true,
  });
  if (error) {
    throw new Error(`list offers: ${error.message}`);
  }
  print({
    mode: ctx.mode,
    tenant: { id: tenant.id, slug: tenant.slug, active: tenant.active },
    subscriptions: (subs ?? []).map((s) => ({
      status: s.status,
      provider: s.provider,
      livemode: s.livemode,
      plan: (s.plans as { code?: string } | null)?.code ?? null,
      current_period_end: s.current_period_end,
      cancel_at_period_end: s.cancel_at_period_end,
      billing_activation:
        (s.metadata as Record<string, unknown> | null)?.billing_activation ?? null,
    })),
    offers: parseBillingOffers(offers).map((o) => {
      const terms = computeOfferTerms(o);
      return {
        ...o,
        usable_now: isOfferUsable(o, new Date()),
        calendar_coherent: offerCalendarIsCoherent(o),
        contract_deadline: terms.contractDeadline,
        terms: terms.lines,
      };
    }),
  });
  const couponId = flag("--coupon-id");
  if (couponId) {
    const coupon = await ctx.stripe.coupons.retrieve(couponId, { expand: ["applies_to"] });
    print({
      coupon: {
        id: coupon.id,
        livemode: coupon.livemode,
        valid: coupon.valid,
        amount_off: coupon.amount_off,
        currency: coupon.currency,
        duration: coupon.duration,
        duration_in_months: coupon.duration_in_months,
        max_redemptions: coupon.max_redemptions,
        times_redeemed: coupon.times_redeemed,
        redeem_by: coupon.redeem_by ? new Date(coupon.redeem_by * 1000).toISOString() : null,
        applies_to: coupon.applies_to?.products ?? null,
      },
    });
  }
}

async function coupon(ctx: Ctx) {
  const couponId = required("--coupon-id");
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(couponId)) {
    throw new Error("--coupon-id: letters, digits, _ and - only");
  }
  const redeemBy = isoArg("--redeem-by") as string;
  const amountOff = intArg("--amount-off", 4000);
  const months = intArg("--months", 2);
  const pro = await planPrice(ctx, "pro");
  if (amountOff >= pro.unit_amount) {
    throw new Error("--amount-off must be below the Pro price");
  }
  const params: Stripe.CouponCreateParams = {
    id: couponId,
    name: flag("--name") ?? `Pro a ${(pro.unit_amount - amountOff) / 100} € (${months} meses)`,
    amount_off: amountOff,
    currency: "eur",
    duration: "repeating",
    duration_in_months: months,
    max_redemptions: 1,
    redeem_by: Math.floor(Date.parse(redeemBy) / 1000),
    applies_to: { products: [pro.provider_product_id] },
    metadata: { gestcopy_offer: "tenant_billing_offer_v1" },
  };

  let existing: Stripe.Coupon | null = null;
  try {
    existing = await ctx.stripe.coupons.retrieve(couponId, { expand: ["applies_to"] });
  } catch (error) {
    if (!(error instanceof Stripe.errors.StripeInvalidRequestError) || error.code !== "resource_missing") {
      throw error;
    }
  }

  if (existing) {
    const mismatches = [
      existing.amount_off !== amountOff && "amount_off",
      existing.currency !== "eur" && "currency",
      existing.duration !== "repeating" && "duration",
      existing.duration_in_months !== months && "duration_in_months",
      existing.max_redemptions !== 1 && "max_redemptions",
      existing.redeem_by !== params.redeem_by && "redeem_by",
      JSON.stringify(existing.applies_to?.products ?? []) !==
        JSON.stringify([pro.provider_product_id]) && "applies_to",
    ].filter(Boolean);
    print({ mode: ctx.mode, coupon: couponId, exists: true, valid: existing.valid, mismatches });
    if (mismatches.length > 0) {
      process.exitCode = 1;
    }
    return;
  }

  if (!ctx.confirmed) {
    print({ mode: ctx.mode, dry_run: true, would_create_coupon: params });
    return;
  }
  const created = await ctx.stripe.coupons.create(params, {
    idempotencyKey: `gestcopy-offer-coupon:${couponId}`,
  });
  print({ mode: ctx.mode, created: true, coupon: created.id, livemode: created.livemode });
}

async function grant(ctx: Ctx) {
  const tenant = await tenantBySlug(ctx, required("--tenant"));
  const couponId = required("--coupon-id");
  const pro = await planPrice(ctx, "pro");
  const payload = {
    p_tenant_id: tenant.id,
    p_plan_code: "pro",
    p_livemode: ctx.livemode,
    p_provider_coupon_id: couponId,
    p_discount_amount: intArg("--amount-off", 4000),
    p_currency: "eur",
    p_discount_months: intArg("--months", 2),
    p_billing_cycle_anchor: isoArg("--anchor", true),
    p_promo_ends_before: isoArg("--promo-ends-before"),
    p_redeem_by: isoArg("--redeem-by"),
    p_terms_version: required("--terms-version"),
    p_reason: required("--reason"),
    p_authorized_by: required("--authorized-by"),
  };

  // The coupon must exist and match before an offer points at it.
  const stripeCoupon = await ctx.stripe.coupons.retrieve(couponId, { expand: ["applies_to"] });
  const [probe] = parseBillingOffers([
    {
      offer_id: "00000000-0000-4000-8000-000000000000",
      tenant_id: tenant.id,
      plan_code: "pro",
      plan_name: "Gestcopy Pro",
      plan_price_monthly: pro.unit_amount / 100,
      plan_currency: "EUR",
      livemode: ctx.livemode,
      provider_coupon_id: couponId,
      discount_amount: payload.p_discount_amount,
      currency: "eur",
      discount_months: payload.p_discount_months,
      billing_cycle_anchor: payload.p_billing_cycle_anchor,
      promo_ends_before: payload.p_promo_ends_before,
      redeem_by: payload.p_redeem_by,
      terms_version: payload.p_terms_version,
      status: "active",
      accepted_at: null,
    },
  ]);
  if (!probe) {
    throw new Error("Offer values are not consistent (amount, months or dates)");
  }
  // Fixed calendar (D1): anchor + months must be exactly --promo-ends-before.
  if (!offerCalendarIsCoherent(probe)) {
    throw new Error(
      "calendar_mismatch: --anchor plus --months must equal --promo-ends-before (the first regular charge)"
    );
  }
  const check = checkOfferCoupon({
    coupon: { ...stripeCoupon, applies_to: stripeCoupon.applies_to ?? null },
    offer: probe,
    productId: pro.provider_product_id,
    sessionExpiresAtUnix: Math.floor(Date.now() / 1000),
  });
  if (!check.ok) {
    throw new Error(`Coupon does not match the offer: ${check.reason}`);
  }

  const terms = computeOfferTerms(probe);
  const preview = {
    usable_now: isOfferUsable(probe, new Date()),
    contract_deadline: terms.contractDeadline,
    terms: terms.lines,
  };
  if (!ctx.confirmed) {
    print({ mode: ctx.mode, dry_run: true, tenant: tenant.slug, payload, preview });
    return;
  }
  const { data, error } = await ctx.admin.rpc("grant_tenant_billing_offer_v1", payload);
  if (error) {
    throw new Error(`grant: ${error.message}`);
  }
  print({ mode: ctx.mode, tenant: tenant.slug, result: data, preview });
}

async function revoke(ctx: Ctx) {
  const payload = {
    p_offer_id: required("--offer-id"),
    p_reason: required("--reason"),
    p_authorized_by: required("--authorized-by"),
  };
  if (!ctx.confirmed) {
    print({ mode: ctx.mode, dry_run: true, payload });
    return;
  }
  const { data, error } = await ctx.admin.rpc("revoke_tenant_billing_offer_v1", payload);
  if (error) {
    throw new Error(`revoke: ${error.message}`);
  }
  print({ mode: ctx.mode, result: data });
}

async function portal(ctx: Ctx) {
  const basic = await planPrice(ctx, "basic");
  const pro = await planPrice(ctx, "pro");
  const existing = await ctx.stripe.billingPortal.configurations.list({ active: true, limit: 100 });
  const found = existing.data.find((c) => c.metadata?.gestcopy_portal === PORTAL_MARKER);
  if (found) {
    print({
      mode: ctx.mode,
      exists: true,
      configuration: found.id,
      is_default: found.is_default,
      env: "STRIPE_PORTAL_CONFIGURATION_PLAN_CHANGE",
    });
    if (found.is_default) {
      console.error("The plan-change configuration is the account default: every customer could switch to Pro.");
      process.exitCode = 1;
    }
    return;
  }
  // Stripe makes the first configuration of an account its default. Basic
  // customers use the default, so it must exist first and not offer Pro.
  const fallback = existing.data.find((c) => c.is_default);
  if (!fallback) {
    throw new Error(
      "No default Customer Portal configuration: save the portal settings in the Stripe Dashboard first (plan changes off), or this one would become the default."
    );
  }
  if (fallback.features.subscription_update.enabled) {
    throw new Error(
      `The default Customer Portal configuration (${fallback.id}) allows plan changes: turn them off before selling Pro by offer only.`
    );
  }
  // Pro subscribers may move to Basic at period end (a lower amount waits for
  // the renewal, no proration), cancel at period end, update the card and
  // see invoices. Basic subscribers never get this configuration.
  const params: Stripe.BillingPortal.ConfigurationCreateParams = {
    name: "Gestcopy · cambio de plan",
    metadata: { gestcopy_portal: PORTAL_MARKER },
    features: {
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
      subscription_cancel: { enabled: true, mode: "at_period_end", proration_behavior: "none" },
      subscription_update: {
        enabled: true,
        default_allowed_updates: ["price"],
        proration_behavior: "none",
        products: [
          { product: pro.provider_product_id, prices: [pro.provider_price_id] },
          { product: basic.provider_product_id, prices: [basic.provider_price_id] },
        ],
        schedule_at_period_end: { conditions: [{ type: "decreasing_item_amount" }] },
      },
    },
  };
  if (!ctx.confirmed) {
    print({ mode: ctx.mode, dry_run: true, would_create_portal_configuration: params });
    return;
  }
  const created = await ctx.stripe.billingPortal.configurations.create(params);
  print({
    mode: ctx.mode,
    created: true,
    configuration: created.id,
    env: "STRIPE_PORTAL_CONFIGURATION_PLAN_CHANGE",
  });
}

async function main() {
  const command = process.argv[2];
  const commands: Record<string, (ctx: Ctx) => Promise<void>> = {
    inspect,
    coupon,
    grant,
    revoke,
    portal,
  };
  const run = command ? commands[command] : undefined;
  if (!run) {
    console.error("Usage: tenant-billing-offer.ts <inspect|coupon|grant|revoke|portal> [flags]");
    process.exitCode = 1;
    return;
  }
  await run(context());
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
