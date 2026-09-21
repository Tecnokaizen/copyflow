import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, it } from "node:test";

import {
  assertStripeConfig,
  getStripeMode,
  stripeModeToLivemode,
} from "./stripe-config";
import { selectStripePriceCandidate } from "./select-price";

const root = path.join(import.meta.dirname, "../..");

function readSource(...parts: string[]) {
  return readFileSync(path.join(root, ...parts), "utf8");
}

const originalEnv = { ...process.env };

function restoreEnv() {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) {
      delete process.env[key];
    }
  }
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

afterEach(() => {
  restoreEnv();
});

describe("billing stripe helper", () => {
  it("stripe client module is server-only and has no NEXT_PUBLIC secrets", () => {
    const source = readSource("lib/billing/stripe.ts");
    assert.match(source, /import "server-only"/);
    assert.match(source, /from "stripe"/);
    assert.match(source, /getStripe/);
    assert.doesNotMatch(source, /NEXT_PUBLIC_STRIPE/);
  });

  it("maps Stripe mode to livemode", () => {
    assert.equal(stripeModeToLivemode("test"), false);
    assert.equal(stripeModeToLivemode("live"), true);
  });

  it("requires STRIPE_MODE for getStripeMode", () => {
    delete process.env.STRIPE_MODE;
    assert.throws(() => getStripeMode(), /STRIPE_MODE/);

    process.env.STRIPE_MODE = "sandbox";
    assert.throws(() => getStripeMode(), /STRIPE_MODE/);

    process.env.STRIPE_MODE = "test";
    assert.equal(getStripeMode(), "test");

    process.env.STRIPE_MODE = "live";
    assert.equal(getStripeMode(), "live");
  });

  it("validates full Stripe config without throwing on import", () => {
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    delete process.env.STRIPE_MODE;

    const missing = assertStripeConfig();
    assert.equal(missing.ok, false);

    process.env.STRIPE_MODE = "test";
    process.env.STRIPE_SECRET_KEY = "sk_test_placeholder";
    assert.equal(assertStripeConfig().ok, false);

    process.env.STRIPE_WEBHOOK_SECRET = "whsec_placeholder";
    const ok = assertStripeConfig();
    assert.equal(ok.ok, true);
    if (ok.ok) {
      assert.equal(ok.mode, "test");
      assert.equal(ok.secretKey, "sk_test_placeholder");
    }
  });

  it("env example documents placeholders only", () => {
    const envExample = readSource(".env.example");
    assert.match(envExample, /STRIPE_SECRET_KEY=/);
    assert.match(envExample, /STRIPE_WEBHOOK_SECRET=/);
    assert.match(envExample, /STRIPE_MODE=/);
    assert.doesNotMatch(envExample, /sk_live_/);
    assert.doesNotMatch(envExample, /whsec_[A-Za-z0-9]{10,}/);
  });
});

describe("billing price resolution", () => {
  it("resolver module is server-only and uses billing_prices not plans.metadata", () => {
    const source = readSource("lib/billing/resolve-price.ts");
    assert.match(source, /import "server-only"/);
    assert.match(source, /billing_prices/);
    assert.match(source, /createAdminClient/);
    assert.doesNotMatch(source, /plans\.metadata|metadata\.stripe/);
    assert.doesNotMatch(source, /price_[A-Za-z0-9]{8,}/);
  });

  it("selects test vs live and rejects inactive/missing/ambiguous", () => {
    const base = {
      providerProductId: "prod_x",
      billingInterval: "month" as const,
      currency: "EUR",
      unitAmount: 3900,
      planId: "plan-basic",
      planCode: "basic",
      planActive: true,
    };

    const test = selectStripePriceCandidate(
      { planCode: "basic", interval: "month", livemode: false },
      [
        {
          ...base,
          providerPriceId: "price_test",
          livemode: false,
          active: true,
        },
        {
          ...base,
          providerPriceId: "price_live",
          livemode: true,
          active: true,
        },
      ]
    );
    assert.equal(test.providerPriceId, "price_test");
    assert.equal(test.livemode, false);

    const live = selectStripePriceCandidate(
      { planCode: "basic", interval: "month", livemode: true },
      [
        {
          ...base,
          providerPriceId: "price_test",
          livemode: false,
          active: true,
        },
        {
          ...base,
          providerPriceId: "price_live",
          livemode: true,
          active: true,
        },
      ]
    );
    assert.equal(live.providerPriceId, "price_live");

    assert.throws(
      () =>
        selectStripePriceCandidate(
          { planCode: "basic", interval: "month", livemode: false },
          [
            {
              ...base,
              providerPriceId: "price_old",
              livemode: false,
              active: false,
            },
          ]
        ),
      /No active Stripe price/
    );

    assert.throws(
      () =>
        selectStripePriceCandidate(
          { planCode: "basic", interval: "month", livemode: false },
          [
            {
              ...base,
              providerPriceId: "price_test",
              livemode: false,
              active: true,
              planActive: false,
            },
          ]
        ),
      /No active Stripe price/
    );

    assert.throws(
      () =>
        selectStripePriceCandidate(
          { planCode: "basic", interval: "month", livemode: false },
          []
        ),
      /No active Stripe price/
    );

    assert.throws(
      () =>
        selectStripePriceCandidate(
          { planCode: "basic", interval: "month", livemode: false },
          [
            {
              ...base,
              providerPriceId: "price_a",
              livemode: false,
              active: true,
            },
            {
              ...base,
              providerPriceId: "price_b",
              livemode: false,
              active: true,
            },
          ]
        ),
      /Ambiguous/
    );
  });

  it("foundation migration defines sync RPC and provider uniqueness", () => {
    const migration = readSource(
      "supabase/migrations/20260921200000_billing_foundation_v1.sql"
    );
    assert.match(migration, /create table public\.billing_prices/);
    assert.match(migration, /create table public\.billing_webhook_events/);
    assert.match(
      migration,
      /subscriptions_provider_subscription_unique/
    );
    assert.match(migration, /sync_billing_subscription_v1/);
    assert.match(migration, /security definer/);
    assert.match(migration, /grant execute[\s\S]*service_role/);
  });

  it("basic plan migration seeds 39 EUR without storage_bytes", () => {
    const migration = readSource(
      "supabase/migrations/20260921201000_billing_basic_plan_v1.sql"
    );
    assert.match(migration, /'basic'/);
    assert.match(migration, /Gestcopy Basic/);
    assert.match(migration, /39\.00/);
    assert.match(migration, /core_team/);
    assert.match(migration, /storage_bytes/);
    assert.match(migration, /delete from public\.plan_features/);
  });
});
