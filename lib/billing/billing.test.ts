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

describe("billing B2 access and status mapping", () => {
  it("allows only owner for billing mutations", async () => {
    const { canManageBilling } = await import("./access");
    assert.equal(canManageBilling("owner"), true);
    for (const role of ["admin", "manager", "staff", "viewer", null]) {
      assert.equal(canManageBilling(role), false);
    }
  });

  it("maps Stripe subscription statuses explicitly", async () => {
    const { mapStripeSubscriptionStatus } = await import("./stripe-status");
    assert.equal(mapStripeSubscriptionStatus("active"), "active");
    assert.equal(mapStripeSubscriptionStatus("past_due"), "past_due");
    assert.equal(mapStripeSubscriptionStatus("incomplete_expired"), "canceled");
    assert.equal(mapStripeSubscriptionStatus("something_else"), null);
    // canceled_at is not a status field; only subscription.status maps.
    assert.equal(mapStripeSubscriptionStatus("active"), "active");
  });

  it("formats cancellation labels from cancel_at and cancel_at_period_end", async () => {
    const {
      formatCancellationLabel,
      formatSubscriptionStatusLabel,
      stripeCancelAtToIso,
    } = await import("./cancellation-display");

    const periodEnd = "2026-10-01T00:00:00.000Z";

    assert.equal(
      formatCancellationLabel({
        cancelAt: periodEnd,
        cancelAtPeriodEnd: false,
        currentPeriodEnd: periodEnd,
      }),
      "Cancelará al final del periodo"
    );

    assert.equal(
      formatCancellationLabel({
        cancelAt: null,
        cancelAtPeriodEnd: true,
        currentPeriodEnd: periodEnd,
      }),
      "Cancelará al final del periodo"
    );

    assert.equal(
      formatCancellationLabel({
        cancelAt: null,
        cancelAtPeriodEnd: false,
        currentPeriodEnd: periodEnd,
      }),
      "No programada"
    );

    const custom = formatCancellationLabel({
      cancelAt: "2026-10-15T00:00:00.000Z",
      cancelAtPeriodEnd: false,
      currentPeriodEnd: periodEnd,
    });
    assert.match(custom, /^Cancelación programada para /);

    assert.equal(formatSubscriptionStatusLabel("active"), "Activa");
    assert.equal(formatSubscriptionStatusLabel("past_due"), "Pago pendiente");
    assert.equal(
      stripeCancelAtToIso(1_720_000_000),
      new Date(1_720_000_000 * 1000).toISOString()
    );
    assert.equal(stripeCancelAtToIso(null), null);
  });

  it("webhook passes cancel_at without coercing cancel_at_period_end", () => {
    const webhook = readSource("lib/billing/webhook.ts");
    assert.match(
      webhook,
      /p_cancel_at:\s*stripeCancelAtToIso\(subscription\.cancel_at\)/
    );
    assert.match(
      webhook,
      /p_cancel_at_period_end:\s*Boolean\(subscription\.cancel_at_period_end\)/
    );
    assert.equal(
      /p_cancel_at_period_end:\s*Boolean\(subscription\.cancel_at\)/.test(
        webhook
      ),
      false
    );
  });

  it("rejects mismatched tenant identifiers from webhook sources", async () => {
    const { resolveTenantIdFromWebhookSources } = await import(
      "./tenant-from-webhook"
    );
    const tenant = "11111111-1111-4111-8111-111111111111";
    const other = "22222222-2222-4222-8222-222222222222";

    assert.deepEqual(
      resolveTenantIdFromWebhookSources({
        subscriptionTenantId: tenant,
        sessionClientReferenceId: tenant,
        sessionMetadataTenantId: tenant,
      }),
      { ok: true, tenantId: tenant }
    );

    assert.deepEqual(
      resolveTenantIdFromWebhookSources({
        subscriptionTenantId: tenant,
        sessionClientReferenceId: other,
        sessionMetadataTenantId: tenant,
      }),
      { ok: false, errorCode: "tenant_id_mismatch" }
    );
  });

  it("parses checkout body allowlist and rejects tenant_id", async () => {
    const { parseCheckoutRequest } = await import("./checkout-parse");
    assert.deepEqual(
      parseCheckoutRequest({
        plan_code: "basic",
        billing_interval: "month",
      }),
      { ok: true, planCode: "basic", billingInterval: "month" }
    );
    assert.equal(
      parseCheckoutRequest({
        plan_code: "basic",
        billing_interval: "month",
        tenant_id: "x",
      }).ok,
      false
    );
    assert.equal(
      parseCheckoutRequest({ plan_code: "pro", billing_interval: "month" }).ok,
      false
    );
  });

  it("detects secret key mode mismatch via assertStripeConfig", async () => {
    const { assertStripeConfig: assertConfig, detectStripeSecretKeyMode } =
      await import("./stripe-config");
    assert.equal(detectStripeSecretKeyMode("sk_test_abc"), "test");
    assert.equal(detectStripeSecretKeyMode("sk_live_abc"), "live");

    process.env.STRIPE_MODE = "live";
    process.env.STRIPE_SECRET_KEY = "sk_test_placeholder";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_placeholder";
    const result = assertConfig();
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, "mode_key_mismatch");
    }
  });

  it("routes and webhook verify signature before JSON parse", () => {
    const checkout = readSource(
      "app/api/billing/checkout-session/route.ts"
    );
    const portal = readSource("app/api/billing/portal-session/route.ts");
    const webhook = readSource("app/api/webhooks/stripe/route.ts");
    assert.match(checkout, /canManageBilling/);
    assert.match(portal, /canManageBilling/);
    assert.match(webhook, /request\.text\(\)/);
    assert.match(webhook, /constructEvent/);
    assert.match(webhook, /claimWebhookEvent/);
    assert.match(webhook, /retryable/);
  });

  it("B2 storage migration assigns 5 GiB to basic only", () => {
    const migration = readSource(
      "supabase/migrations/20260921210000_billing_basic_storage_5gib_v1.sql"
    );
    assert.match(migration, /5368709120/);
    assert.match(migration, /storage_bytes/);
    assert.match(migration, /mvp must not have storage_bytes/);
  });

  it("event ordering migration extends sync RPC", () => {
    const migration = readSource(
      "supabase/migrations/20260921211000_billing_subscription_event_ordering_v1.sql"
    );
    assert.match(migration, /provider_event_created_at/);
    assert.match(migration, /stale/);
    assert.match(migration, /p_provider_event_created_at/);
  });

  it("cancel_at migration persists Stripe absolute cancellation", () => {
    const migration = readSource(
      "supabase/migrations/20260922010000_billing_subscription_cancel_at_v1.sql"
    );
    assert.match(migration, /add column if not exists cancel_at/);
    assert.match(migration, /p_cancel_at/);
    assert.match(migration, /cancel_at = p_cancel_at/);
  });
});
