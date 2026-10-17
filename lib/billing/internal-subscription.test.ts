import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { canManageBilling } from "./access";
import { parseCheckoutRequest } from "./checkout-parse";
import {
  CURRENT_SUBSCRIPTION_STATUSES,
  INTERNAL_SUBSCRIPTION_CURRENT_CODE,
  hasCurrentNonStripeSubscription,
} from "./internal-subscription";
import { CURRENT_SUBSCRIPTION_EXISTS_CODE } from "./webhook-errors";

const root = path.join(import.meta.dirname, "../..");

function readSource(...parts: string[]) {
  return readFileSync(path.join(root, ...parts), "utf8");
}

/** Shape of SUR4's internal trial row in Production (17/10/2026). */
const sur4Trial = {
  provider: "internal",
  status: "trialing",
  current_period_start: "2026-09-26T13:53:09.342441+00:00",
  current_period_end: "2026-11-02T13:53:09.342441+00:00",
  metadata: {
    source: "sur4_cutover",
    billing_activation: "deferred_until_go_live",
  },
};

describe("internal subscription checkout guard · decision", () => {
  it("uses a dedicated 409 code distinct from the Stripe conflict", () => {
    assert.equal(INTERNAL_SUBSCRIPTION_CURRENT_CODE, "internal_subscription_current");
    assert.notEqual(
      INTERNAL_SUBSCRIPTION_CURRENT_CODE,
      CURRENT_SUBSCRIPTION_EXISTS_CODE
    );
    assert.deepEqual([...CURRENT_SUBSCRIPTION_STATUSES], [
      "trialing",
      "active",
      "past_due",
    ]);
  });

  it("blocks a current internal trial such as SUR4's", () => {
    assert.equal(hasCurrentNonStripeSubscription([sur4Trial]), true);
  });

  it("keeps blocking after current_period_end has passed while the status is current", () => {
    const now = Date.parse("2026-11-02T14:00:00Z");
    assert.ok(Date.parse(sur4Trial.current_period_end) < now);
    for (const status of ["trialing", "active", "past_due"]) {
      const expired = {
        ...sur4Trial,
        status,
        current_period_end: "2026-11-02T13:53:09.342441+00:00",
      };
      assert.equal(hasCurrentNonStripeSubscription([expired]), true, status);
    }
    const longExpired = { ...sur4Trial, current_period_end: "2020-01-01T00:00:00Z" };
    assert.equal(hasCurrentNonStripeSubscription([longExpired]), true);
  });

  it("blocks every current status: trialing, active and past_due", () => {
    for (const status of ["trialing", "active", "past_due"]) {
      assert.equal(
        hasCurrentNonStripeSubscription([{ provider: "internal", status }]),
        true,
        status
      );
    }
  });

  it("has no billing_activation exception: conversion needs its own flow", () => {
    for (const billing_activation of [
      "ready_for_checkout",
      "internal_pilot",
      "stripe_checkout_pending",
    ]) {
      const row = { ...sur4Trial, metadata: { billing_activation } };
      assert.equal(
        hasCurrentNonStripeSubscription([row]),
        true,
        billing_activation
      );
    }
  });

  it("ignores non-current internal rows (canceled history, unpaid, incomplete)", () => {
    for (const status of ["canceled", "unpaid", "incomplete", "paused"]) {
      assert.equal(
        hasCurrentNonStripeSubscription([{ provider: "internal", status }]),
        false,
        status
      );
    }
    assert.equal(
      hasCurrentNonStripeSubscription([{ provider: "internal", status: null }]),
      false
    );
  });

  it("treats any non-Stripe provider, including NULL and mvp, as internal", () => {
    for (const provider of [null, "internal", "mvp", "manual", ""]) {
      assert.equal(
        hasCurrentNonStripeSubscription([{ provider, status: "active" }]),
        true,
        String(provider)
      );
    }
  });

  it("leaves tenants without internal subscription to the Stripe-only RPC", () => {
    assert.equal(hasCurrentNonStripeSubscription([]), false);
    assert.equal(
      hasCurrentNonStripeSubscription([
        { provider: "stripe", status: "active" },
        { provider: "stripe", status: "past_due" },
        { provider: "internal", status: "canceled" },
      ]),
      false
    );
  });

  it("blocks when any row is a current internal one", () => {
    assert.equal(
      hasCurrentNonStripeSubscription([
        { provider: "internal", status: "canceled" },
        { provider: "stripe", status: "canceled" },
        sur4Trial,
      ]),
      true
    );
  });
});

describe("internal subscription checkout guard · tenant and permissions", () => {
  it("only the owner can manage billing", () => {
    assert.equal(canManageBilling("owner"), true);
    for (const role of ["admin", "operator", "viewer", "member", null, undefined, ""]) {
      assert.equal(canManageBilling(role), false, String(role));
    }
  });

  it("the checkout body never carries a tenant", () => {
    assert.deepEqual(
      parseCheckoutRequest({
        plan_code: "basic",
        billing_interval: "month",
        tenant_id: "22222222-2222-4222-8222-222222222222",
      }),
      { ok: false, error: "Unexpected fields" }
    );
  });

  it("the checkout route takes tenant_id from the host context only", () => {
    const route = readSource("app/api/billing/checkout-session/route.ts");
    assert.match(route, /const context = await getCurrentContext\(\);/);
    assert.match(
      route,
      /if \(!context \|\| !canManageBilling\(context\.membership\.role\)\)\s*\{\s*return json\([^)]*403\)/
    );
    assert.match(route, /tenantId: context\.tenant\.id,/);
    assert.doesNotMatch(route, /tenantId: (?!context\.tenant\.id)/);
    assert.doesNotMatch(route, /body\.tenant|parsed\.tenant/);
  });
});

describe("internal subscription checkout guard · wiring", () => {
  it("queries current rows of every provider and mode, by status only", () => {
    const current = readSource("lib/billing/current-subscription.ts");
    const start = current.indexOf(
      "export async function tenantHasCurrentNonStripeSubscription"
    );
    assert.ok(start > 0);
    const guard = current.slice(start, current.indexOf("\n}\n", start));
    assert.match(guard, /\.from\("subscriptions"\)/);
    assert.match(guard, /\.select\("provider, status"\)/);
    assert.match(guard, /\.eq\("tenant_id", tenantId\)/);
    assert.match(guard, /\.in\("status", \[\.\.\.CURRENT_SUBSCRIPTION_STATUSES\]\)/);
    assert.match(guard, /hasCurrentNonStripeSubscription/);
    // NULL providers must reach the TS filter; internal rows have no Stripe mode.
    assert.doesNotMatch(guard, /\.neq\(/);
    assert.doesNotMatch(guard, /\.eq\("provider"/);
    assert.doesNotMatch(guard, /livemode/);
    // Expiry is not cancellation: no date filters.
    assert.doesNotMatch(guard, /current_period_end|\.(lt|lte|gt|gte)\(/);
    // A failed lookup must not let Checkout through.
    assert.match(guard, /if \(error\) \{\s*throw new Error/);
  });

  it("checks the guard before reserving or reusing a Checkout attempt", () => {
    const checkout = readSource("lib/billing/checkout.ts");
    const fn = checkout.slice(
      checkout.indexOf("export async function createCheckoutSessionForTenant")
    );
    const guard = fn.indexOf("tenantHasCurrentNonStripeSubscription(input.tenantId)");
    const prepare = fn.indexOf("prepareCheckoutAttempt(");
    const stripeCreate = fn.indexOf("createStripeCheckoutForAttempt(");
    assert.ok(guard > 0, "guard call missing");
    assert.ok(guard < prepare, "guard must run before prepareCheckoutAttempt");
    assert.ok(guard < stripeCreate, "guard must run before Stripe Checkout");
    assert.match(
      fn,
      /tenantHasCurrentNonStripeSubscription\(input\.tenantId\)\)\s*\{\s*throw new CheckoutInternalSubscriptionError\(\)/
    );
    assert.match(
      checkout,
      /class CheckoutInternalSubscriptionError[\s\S]*readonly code = INTERNAL_SUBSCRIPTION_CURRENT_CODE/
    );
    assert.doesNotMatch(checkout, /ready_for_checkout|billing_activation/);
  });

  for (const route of [
    "app/api/billing/checkout-session/route.ts",
    "app/api/onboarding/route.ts",
  ]) {
    it(`${route} maps the guard to 409 internal_subscription_current`, () => {
      const source = readSource(route);
      assert.match(
        source,
        /error instanceof CheckoutInternalSubscriptionError\)\s*\{\s*return json\(\s*\{[\s\S]*?code: INTERNAL_SUBSCRIPTION_CURRENT_CODE,\s*\},\s*409\s*\)/
      );
    });
  }
});
