import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import type Stripe from "stripe";

import { subscriptionIdFromInvoice } from "./invoice-subscription";
import {
  hasCurrentStripeSubscriptionForLivemode,
  pickStripeCustomerIdForLivemode,
} from "./livemode-select";
import { stripeModeToLivemode } from "./stripe-config";
import {
  eventLivemodeMatchesExpected,
  objectLivemodeMatchesEvent,
} from "./webhook-mode";
import { isRetryableWebhookFailure } from "./webhook-errors";

const root = path.join(import.meta.dirname, "../..");

function readSource(...parts: string[]) {
  return readFileSync(path.join(root, ...parts), "utf8");
}

describe("stripe live hardening · webhook mode", () => {
  it("allows matching STRIPE_MODE and event.livemode", () => {
    assert.equal(
      eventLivemodeMatchesExpected(false, stripeModeToLivemode("test")),
      true
    );
    assert.equal(
      eventLivemodeMatchesExpected(true, stripeModeToLivemode("live")),
      true
    );
  });

  it("rejects mismatched STRIPE_MODE and event.livemode", () => {
    assert.equal(
      eventLivemodeMatchesExpected(true, stripeModeToLivemode("test")),
      false
    );
    assert.equal(
      eventLivemodeMatchesExpected(false, stripeModeToLivemode("live")),
      false
    );
  });

  it("object livemode must match event when present", () => {
    assert.equal(objectLivemodeMatchesEvent(false, false), true);
    assert.equal(objectLivemodeMatchesEvent(true, true), true);
    assert.equal(objectLivemodeMatchesEvent(true, false), false);
    assert.equal(objectLivemodeMatchesEvent(undefined, true), true);
    assert.equal(objectLivemodeMatchesEvent(null, false), true);
  });

  it("webhook route fail-closes before claim on mode mismatch", () => {
    const route = readSource("app/api/webhooks/stripe/route.ts");
    assert.match(route, /stripe_mode_mismatch/);
    assert.match(route, /eventLivemodeMatchesExpected/);
    assert.match(route, /stripeModeToLivemode\(config\.mode\)/);
    const modeCheckIdx = route.indexOf("eventLivemodeMatchesExpected");
    const claimCallIdx = route.indexOf("await claimWebhookEvent");
    assert.ok(modeCheckIdx > 0 && claimCallIdx > modeCheckIdx);
  });

  it("mode mismatch errors are deterministic (non-retryable)", () => {
    assert.equal(isRetryableWebhookFailure("stripe_mode_mismatch"), false);
    assert.equal(isRetryableWebhookFailure("stripe_object_mode_mismatch"), false);
    assert.equal(isRetryableWebhookFailure("invoice_subscription_mismatch"), false);
  });
});

describe("stripe live hardening · invoice subscription resolution", () => {
  function invoice(partial: {
    parentSubscription?: string | Stripe.Subscription | null;
    legacySubscription?: string | Stripe.Subscription | null;
  }): Stripe.Invoice {
    const parent =
      partial.parentSubscription === undefined
        ? null
        : {
            type: "subscription_details" as const,
            quote_details: null,
            subscription_details: {
              metadata: null,
              subscription: partial.parentSubscription as string | Stripe.Subscription,
            },
          };

    const base = {
      id: "in_test",
      object: "invoice",
      livemode: false,
      parent,
    } as Stripe.Invoice;

    if (partial.legacySubscription !== undefined) {
      return {
        ...base,
        subscription: partial.legacySubscription,
      } as Stripe.Invoice & { subscription?: string | Stripe.Subscription | null };
    }

    return base;
  }

  it("uses canonical parent.subscription_details.subscription", () => {
    const result = subscriptionIdFromInvoice(
      invoice({ parentSubscription: "sub_canonical" })
    );
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.subscriptionId, "sub_canonical");
      assert.equal(result.source, "canonical");
    }
  });

  it("falls back to legacy invoice.subscription", () => {
    const result = subscriptionIdFromInvoice(
      invoice({ legacySubscription: "sub_legacy" })
    );
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.subscriptionId, "sub_legacy");
      assert.equal(result.source, "legacy");
    }
  });

  it("accepts canonical + legacy when equal", () => {
    const result = subscriptionIdFromInvoice(
      invoice({
        parentSubscription: "sub_same",
        legacySubscription: "sub_same",
      })
    );
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.subscriptionId, "sub_same");
      assert.equal(result.source, "both_agree");
    }
  });

  it("fail-closes when canonical and legacy differ", () => {
    const result = subscriptionIdFromInvoice(
      invoice({
        parentSubscription: "sub_a",
        legacySubscription: "sub_b",
      })
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.errorCode, "invoice_subscription_mismatch");
    }
  });

  it("returns invoice_without_subscription when neither exists", () => {
    const result = subscriptionIdFromInvoice(invoice({}));
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.errorCode, "invoice_without_subscription");
    }
  });
});

describe("stripe live hardening · customer and current subscription", () => {
  it("Test mode does not return Live customers", () => {
    assert.equal(
      pickStripeCustomerIdForLivemode(
        [
          { provider_customer_id: "cus_live", livemode: true },
          { provider_customer_id: "cus_test", livemode: false },
        ],
        false
      ),
      "cus_test"
    );
    assert.equal(
      pickStripeCustomerIdForLivemode(
        [{ provider_customer_id: "cus_live", livemode: true }],
        false
      ),
      null
    );
  });

  it("Live mode does not return Test customers", () => {
    assert.equal(
      pickStripeCustomerIdForLivemode(
        [
          { provider_customer_id: "cus_test", livemode: false },
          { provider_customer_id: "cus_live", livemode: true },
        ],
        true
      ),
      "cus_live"
    );
    assert.equal(
      pickStripeCustomerIdForLivemode(
        [{ provider_customer_id: "cus_test", livemode: false }],
        true
      ),
      null
    );
  });

  it("Test current does not see Live subscriptions", () => {
    assert.equal(
      hasCurrentStripeSubscriptionForLivemode(
        [
          { status: "active", livemode: true },
          { status: "canceled", livemode: false },
        ],
        false,
        ["trialing", "active", "past_due"]
      ),
      false
    );
    assert.equal(
      hasCurrentStripeSubscriptionForLivemode(
        [{ status: "active", livemode: false }],
        false,
        ["trialing", "active", "past_due"]
      ),
      true
    );
  });

  it("Live current does not see Test subscriptions", () => {
    assert.equal(
      hasCurrentStripeSubscriptionForLivemode(
        [{ status: "active", livemode: false }],
        true,
        ["trialing", "active", "past_due"]
      ),
      false
    );
    assert.equal(
      hasCurrentStripeSubscriptionForLivemode(
        [{ status: "past_due", livemode: true }],
        true,
        ["trialing", "active", "past_due"]
      ),
      true
    );
  });

  it("customer and current modules filter by livemode from STRIPE_MODE", () => {
    const customer = readSource("lib/billing/customer.ts");
    const current = readSource("lib/billing/current-subscription.ts");
    assert.match(customer, /\.eq\("livemode", expected\)/);
    assert.match(customer, /stripeModeToLivemode/);
    assert.match(current, /\.eq\("livemode", expected\)/);
    assert.match(current, /stripeModeToLivemode/);
  });
});

describe("stripe live hardening · checkout reuse and price invariant", () => {
  it("reuse path fail-closes on session livemode mismatch", () => {
    const attempts = readSource("lib/billing/checkout-attempts.ts");
    assert.match(attempts, /CheckoutModeMismatchError/);
    assert.match(attempts, /session\.livemode !== expectedLivemode/);
    assert.match(attempts, /p_livemode/);
  });

  it("checkout derives livemode server-side and checks price.livemode", () => {
    const checkout = readSource("lib/billing/checkout.ts");
    assert.match(checkout, /stripeModeToLivemode\(getStripeMode\(\)\)/);
    assert.match(checkout, /price\.livemode !== input\.livemode/);
    assert.match(checkout, /CheckoutPriceModeMismatchError/);
    assert.doesNotMatch(checkout, /request\.json\(\)[\s\S]*livemode/);
  });

  it("migration adds livemode columns and mode-scoped unique index", () => {
    const migration = readSource(
      "supabase/migrations/20260922160000_stripe_live_hardening_v1.sql"
    );
    assert.match(migration, /subscriptions[\s\S]*livemode boolean not null default false/);
    assert.match(
      migration,
      /billing_checkout_attempts[\s\S]*livemode boolean not null default false/
    );
    assert.match(
      migration,
      /billing_checkout_attempts_one_active_per_tenant[\s\S]*\(tenant_id, livemode\)/
    );
    assert.match(migration, /subscription livemode mismatch/);
    assert.match(migration, /p_livemode/);
  });
});
