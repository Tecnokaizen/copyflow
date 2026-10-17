import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import {
  BILLING_ACTIVATION_READY_FOR_CHECKOUT,
  CURRENT_SUBSCRIPTION_STATUSES,
  INTERNAL_SUBSCRIPTION_CURRENT_CODE,
  billingActivationFromMetadata,
  hasBlockingNonStripeSubscription,
  isReadyForCheckout,
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
  metadata: {
    source: "sur4_cutover",
    billing_activation: "deferred_until_go_live",
    commercial_grace_days: 37,
  },
};

describe("internal subscription checkout guard · decision", () => {
  it("uses a dedicated 409 code distinct from the Stripe conflict", () => {
    assert.equal(INTERNAL_SUBSCRIPTION_CURRENT_CODE, "internal_subscription_current");
    assert.notEqual(
      INTERNAL_SUBSCRIPTION_CURRENT_CODE,
      CURRENT_SUBSCRIPTION_EXISTS_CODE
    );
    assert.equal(BILLING_ACTIVATION_READY_FOR_CHECKOUT, "ready_for_checkout");
    assert.deepEqual([...CURRENT_SUBSCRIPTION_STATUSES], [
      "trialing",
      "active",
      "past_due",
    ]);
  });

  it("blocks a current internal trial such as SUR4's", () => {
    assert.equal(hasBlockingNonStripeSubscription([sur4Trial]), true);
  });

  it("blocks every current status: trialing, active and past_due", () => {
    for (const status of ["trialing", "active", "past_due"]) {
      assert.equal(
        hasBlockingNonStripeSubscription([
          { provider: "internal", status, metadata: {} },
        ]),
        true,
        status
      );
    }
  });

  it("ignores non-current internal rows (canceled history, unpaid, incomplete)", () => {
    for (const status of ["canceled", "unpaid", "incomplete", "paused"]) {
      assert.equal(
        hasBlockingNonStripeSubscription([
          { provider: "internal", status, metadata: {} },
        ]),
        false,
        status
      );
    }
    assert.equal(
      hasBlockingNonStripeSubscription([
        { provider: "internal", status: null, metadata: {} },
      ]),
      false
    );
  });

  it("treats any non-Stripe provider, including NULL and mvp, as internal", () => {
    for (const provider of [null, "mvp", "manual", ""]) {
      assert.equal(
        hasBlockingNonStripeSubscription([
          { provider, status: "active", metadata: {} },
        ]),
        true,
        String(provider)
      );
    }
  });

  it("leaves Stripe rows to the mode-scoped prepare RPC", () => {
    assert.equal(
      hasBlockingNonStripeSubscription([
        { provider: "stripe", status: "active", metadata: {} },
        { provider: "stripe", status: "past_due", metadata: {} },
      ]),
      false
    );
    assert.equal(hasBlockingNonStripeSubscription([]), false);
  });

  it("allows Checkout only when billing_activation is exactly ready_for_checkout", () => {
    assert.equal(
      hasBlockingNonStripeSubscription([
        {
          ...sur4Trial,
          metadata: { ...sur4Trial.metadata, billing_activation: "ready_for_checkout" },
        },
      ]),
      false
    );

    for (const value of [
      "deferred_until_go_live",
      "internal_pilot",
      "stripe_checkout_pending",
      "READY_FOR_CHECKOUT",
      " ready_for_checkout",
      "",
    ]) {
      assert.equal(
        hasBlockingNonStripeSubscription([
          { provider: "internal", status: "trialing", metadata: { billing_activation: value } },
        ]),
        true,
        JSON.stringify(value)
      );
    }
  });

  it("fails closed on missing or malformed metadata", () => {
    for (const metadata of [
      null,
      undefined,
      "ready_for_checkout",
      ["ready_for_checkout"],
      { billing_activation: true },
      { billing_activation: { value: "ready_for_checkout" } },
    ]) {
      assert.equal(
        hasBlockingNonStripeSubscription([
          { provider: "internal", status: "trialing", metadata },
        ]),
        true,
        JSON.stringify(metadata)
      );
    }
  });

  it("blocks when any current internal row is not ready", () => {
    assert.equal(
      hasBlockingNonStripeSubscription([
        {
          provider: "internal",
          status: "active",
          metadata: { billing_activation: "ready_for_checkout" },
        },
        sur4Trial,
      ]),
      true
    );
  });

  it("reads billing_activation defensively", () => {
    assert.equal(
      billingActivationFromMetadata(sur4Trial.metadata),
      "deferred_until_go_live"
    );
    assert.equal(billingActivationFromMetadata({}), null);
    assert.equal(billingActivationFromMetadata(null), null);
    assert.equal(billingActivationFromMetadata([]), null);
    assert.equal(isReadyForCheckout({ billing_activation: "ready_for_checkout" }), true);
    assert.equal(isReadyForCheckout(sur4Trial.metadata), false);
  });
});

describe("internal subscription checkout guard · wiring", () => {
  it("queries current rows of every provider and every mode", () => {
    const current = readSource("lib/billing/current-subscription.ts");
    const start = current.indexOf(
      "export async function tenantHasBlockingNonStripeSubscription"
    );
    assert.ok(start > 0);
    const guard = current.slice(start, current.indexOf("\n}\n", start));
    assert.match(guard, /\.from\("subscriptions"\)/);
    assert.match(guard, /\.select\("provider, status, metadata"\)/);
    assert.match(guard, /\.eq\("tenant_id", tenantId\)/);
    assert.match(guard, /CURRENT_SUBSCRIPTION_STATUSES/);
    assert.match(guard, /hasBlockingNonStripeSubscription/);
    // NULL providers must reach the TS filter; no livemode scoping for internal rows.
    assert.doesNotMatch(guard, /\.neq\(/);
    assert.doesNotMatch(guard, /\.eq\("provider"/);
    assert.doesNotMatch(guard, /livemode/);
    // A failed lookup must not let Checkout through.
    assert.match(guard, /if \(error\) \{\s*throw new Error/);
  });

  it("checks the internal guard before reserving or reusing a Checkout attempt", () => {
    const checkout = readSource("lib/billing/checkout.ts");
    const fn = checkout.slice(
      checkout.indexOf("export async function createCheckoutSessionForTenant")
    );
    const guard = fn.indexOf("tenantHasBlockingNonStripeSubscription(input.tenantId)");
    const prepare = fn.indexOf("prepareCheckoutAttempt(");
    const stripeCreate = fn.indexOf("createStripeCheckoutForAttempt(");
    assert.ok(guard > 0, "guard call missing");
    assert.ok(guard < prepare, "guard must run before prepareCheckoutAttempt");
    assert.ok(guard < stripeCreate, "guard must run before Stripe Checkout");
    assert.match(
      fn,
      /tenantHasBlockingNonStripeSubscription\(input\.tenantId\)\)\s*\{\s*throw new CheckoutInternalSubscriptionError\(\)/
    );
    assert.match(
      checkout,
      /class CheckoutInternalSubscriptionError[\s\S]*readonly code = INTERNAL_SUBSCRIPTION_CURRENT_CODE/
    );
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

describe("internal subscription checkout guard · D2 activar facturación", () => {
  it("subscription API exposes only a derived flag, never raw metadata", () => {
    const route = readSource("app/api/billing/subscription/route.ts");
    assert.match(route, /isReadyForCheckout\(display\.metadata\)/);
    assert.match(
      route,
      /billing_activation_ready: isStripe\s*\?\s*false\s*:\s*isReadyForCheckout/
    );
    assert.doesNotMatch(route, /^\s*metadata: display\.metadata/m);
    assert.doesNotMatch(route, /metadata: display\b/);
  });

  it("billing settings shows Activar facturación only for a ready internal subscription", () => {
    const ui = readSource("components/settings/billing-settings.tsx");
    assert.match(
      ui,
      /isActivationReady =\s*isInternalCurrent && Boolean\(subscription\?\.billing_activation_ready\)/
    );
    assert.match(ui, /\(!isInternalCurrent \|\| isActivationReady\) &&/);
    assert.match(ui, /isActivationReady \? "Activar facturación" : "Contratar Gestcopy Basic"/);
    assert.match(ui, /body\.code === "internal_subscription_current"/);
    assert.match(ui, /aún no está gestionando esta/);
  });
});
