/**
 * Operational Stripe catalog bootstrap (Test Mode by default).
 *
 * Usage:
 *   npx tsx scripts/billing/bootstrap-stripe-catalog.ts --inspect
 *   npx tsx scripts/billing/bootstrap-stripe-catalog.ts --create --confirm-test
 *   npx tsx scripts/billing/bootstrap-stripe-catalog.ts --plan pro --create --confirm-test
 *
 * --plan basic (default) | pro. The Stripe amount must equal the plan's
 * price_monthly in the database (20261028090000 adds pro at 79 EUR).
 *
 * Never creates Live objects unless STRIPE_MODE=live AND --confirm-live.
 * Does not run automatically on app boot.
 */

import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

import {
  assertStripeConfig,
  getStripeMode,
  stripeModeToLivemode,
} from "../../lib/billing/stripe-config";

function hasFlag(name: string) {
  return process.argv.includes(name);
}

function flagValue(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
}

const CATALOG = {
  basic: { productName: "Gestcopy Basic", unitAmount: 3900 },
  pro: { productName: "Gestcopy Pro", unitAmount: 7900 },
} as const;
type CatalogPlan = keyof typeof CATALOG;

function requireEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing ${name}`);
  }
  return value;
}

async function main() {
  const inspectOnly = hasFlag("--inspect") || !hasFlag("--create");
  const create = hasFlag("--create");
  const confirmTest = hasFlag("--confirm-test");
  const confirmLive = hasFlag("--confirm-live");
  const planCode = (flagValue("--plan") ?? "basic") as CatalogPlan;
  if (!(planCode in CATALOG)) {
    console.error("--plan must be basic or pro");
    process.exitCode = 1;
    return;
  }
  const catalog = CATALOG[planCode];

  const config = assertStripeConfig();
  if (!config.ok) {
    console.error("Stripe config incomplete:", config.reason);
    console.error(
      "Required: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_MODE=test|live"
    );
    console.error(
      "Also required for DB upsert: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY (or legacy SUPABASE_SERVICE_ROLE_KEY)"
    );
    process.exitCode = 1;
    return;
  }

  const mode = getStripeMode();
  const livemode = stripeModeToLivemode(mode);

  if (create) {
    if (mode === "test" && !confirmTest) {
      console.error("Refusing to create Test catalog without --confirm-test");
      process.exitCode = 1;
      return;
    }
    if (mode === "live" && !confirmLive) {
      console.error("Refusing to create Live catalog without --confirm-live");
      process.exitCode = 1;
      return;
    }
  }

  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceKey =
    process.env.SUPABASE_SECRET_KEY?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!serviceKey) {
    throw new Error(
      "Missing SUPABASE_SECRET_KEY (preferred) or SUPABASE_SERVICE_ROLE_KEY"
    );
  }
  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: plan, error: planError } = await admin
    .from("plans")
    .select("id, code, name, active, price_monthly, currency")
    .eq("code", planCode)
    .maybeSingle();

  if (planError || !plan) {
    console.error(`Plan ${planCode} not found in DB`);
    process.exitCode = 1;
    return;
  }

  if (
    Math.round(Number(plan.price_monthly) * 100) !== catalog.unitAmount ||
    String(plan.currency).toUpperCase() !== "EUR" ||
    plan.active !== true
  ) {
    console.error(
      `Plan ${planCode} in DB (${plan.price_monthly} ${plan.currency}, active=${plan.active}) does not match the catalog (${catalog.unitAmount / 100} EUR)`
    );
    process.exitCode = 1;
    return;
  }

  const { data: existing, error: existingError } = await admin
    .from("billing_prices")
    .select(
      "id, provider_product_id, provider_price_id, billing_interval, livemode, active, unit_amount, currency"
    )
    .eq("plan_id", plan.id)
    .eq("provider", "stripe")
    .eq("billing_interval", "month")
    .eq("livemode", livemode)
    .eq("active", true);

  if (existingError) {
    console.error("Failed to inspect billing_prices:", existingError.message);
    process.exitCode = 1;
    return;
  }

  console.log(
    JSON.stringify(
      {
        mode,
        livemode,
        plan: { id: plan.id, code: plan.code },
        active_mappings: existing ?? [],
      },
      null,
      2
    )
  );

  if (inspectOnly || !create) {
    console.log("Inspect only. Pass --create with confirm flag to mutate Stripe.");
    return;
  }

  if ((existing ?? []).length > 0) {
    console.log("Active mapping already exists; skipping Stripe create (idempotent).");
    return;
  }

  const stripe = new Stripe(config.secretKey, {
    apiVersion: "2026-08-26.dahlia",
  });

  const product = await stripe.products.create({
    name: catalog.productName,
    metadata: {
      gestcopy_plan_code: planCode,
    },
  });

  const price = await stripe.prices.create({
    product: product.id,
    unit_amount: catalog.unitAmount,
    currency: "eur",
    recurring: { interval: "month" },
    metadata: {
      gestcopy_plan_code: planCode,
    },
  });

  const { error: insertError } = await admin.from("billing_prices").insert({
    plan_id: plan.id,
    provider: "stripe",
    provider_product_id: product.id,
    provider_price_id: price.id,
    billing_interval: "month",
    currency: "EUR",
    unit_amount: catalog.unitAmount,
    livemode,
    active: true,
  });

  if (insertError) {
    console.error("Created Stripe objects but failed DB insert:", insertError.message);
    console.error("product=", product.id, "price=", price.id);
    process.exitCode = 1;
    return;
  }

  console.log(
    JSON.stringify(
      {
        created: true,
        provider_product_id: product.id,
        provider_price_id: price.id,
        livemode,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
