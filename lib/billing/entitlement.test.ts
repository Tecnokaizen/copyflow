import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { canAccessBillingScreen, canManageBilling } from "./access";
import {
  resolveEntitlement,
  stripeCheckoutBlocked,
  type EntitlementSubscription,
} from "./entitlement";
import {
  commercialEntitlementDecision,
  isEntitlementExemptPath,
  SUBSCRIPTION_REQUIRED_BODY,
} from "./entitlement-paths";

const root = path.join(import.meta.dirname, "../..");

function readSource(...parts: string[]) {
  return readFileSync(path.join(root, ...parts), "utf8");
}

function row(
  overrides: Partial<EntitlementSubscription> &
    Pick<EntitlementSubscription, "provider" | "status">
): EntitlementSubscription {
  return {
    livemode: false,
    currentPeriodEnd: null,
    planCode: "basic",
    ...overrides,
  };
}

const NOW = new Date("2026-09-28T12:00:00.000Z");
const FUTURE = "2027-09-05T00:00:00.000Z";
const PAST = "2026-09-01T00:00:00.000Z";

describe("billing entitlement resolver", () => {
  it("allows internal active with a future period end", () => {
    const result = resolveEntitlement({
      subscriptions: [
        row({
          provider: "internal",
          status: "active",
          currentPeriodEnd: FUTURE,
          planCode: "mvp",
        }),
      ],
      expectedLivemode: true,
      now: NOW,
    });
    assert.equal(result.allowed, true);
    assert.equal(result.source, "internal");
    assert.equal(result.reason, "internal_current");
    assert.equal(result.planCode, "mvp");
  });

  it("allows internal trialing with a future period end", () => {
    const result = resolveEntitlement({
      subscriptions: [
        row({
          provider: "internal",
          status: "trialing",
          currentPeriodEnd: FUTURE,
        }),
      ],
      expectedLivemode: true,
      now: NOW,
    });
    assert.equal(result.allowed, true);
    assert.equal(result.reason, "internal_current");
  });

  it("denies internal trialing after the period end", () => {
    const result = resolveEntitlement({
      subscriptions: [
        row({
          provider: "internal",
          status: "trialing",
          currentPeriodEnd: PAST,
        }),
      ],
      expectedLivemode: true,
      now: NOW,
    });
    assert.equal(result.allowed, false);
    assert.equal(result.reason, "internal_expired");
    assert.equal(result.source, "internal");
  });

  it("allows internal active when the period end is null", () => {
    const result = resolveEntitlement({
      subscriptions: [
        row({ provider: "internal", status: "active", currentPeriodEnd: null }),
      ],
      expectedLivemode: true,
      now: NOW,
    });
    assert.equal(result.allowed, true);
    assert.equal(result.reason, "internal_current");
  });

  it("allows Stripe live active, trialing and past_due", () => {
    for (const status of ["active", "trialing", "past_due"] as const) {
      const result = resolveEntitlement({
        subscriptions: [
          row({
            provider: "stripe",
            livemode: true,
            status,
            currentPeriodEnd: PAST,
          }),
        ],
        expectedLivemode: true,
        now: NOW,
      });
      assert.equal(result.allowed, true, status);
      assert.equal(result.source, "stripe");
      assert.equal(result.reason, "stripe_current");
      assert.equal(result.status, status);
    }
  });

  it("denies a canceled Stripe live subscription", () => {
    const result = resolveEntitlement({
      subscriptions: [
        row({ provider: "stripe", livemode: true, status: "canceled" }),
      ],
      expectedLivemode: true,
      now: NOW,
    });
    assert.equal(result.allowed, false);
    assert.equal(result.reason, "no_current_subscription");
  });

  it("ignores Stripe test when the server mode is live", () => {
    const result = resolveEntitlement({
      subscriptions: [
        row({ provider: "stripe", livemode: false, status: "active" }),
      ],
      expectedLivemode: true,
      now: NOW,
    });
    assert.equal(result.allowed, false);
    assert.equal(result.source, "none");
  });

  it("denies a tenant with no subscription", () => {
    const result = resolveEntitlement({
      subscriptions: [],
      expectedLivemode: true,
      now: NOW,
    });
    assert.deepEqual(result, {
      allowed: false,
      source: "none",
      status: null,
      planCode: null,
      reason: "no_current_subscription",
    });
  });

  it("lets a current Stripe live subscription win over internal", () => {
    const result = resolveEntitlement({
      subscriptions: [
        row({
          provider: "internal",
          status: "active",
          currentPeriodEnd: FUTURE,
          planCode: "mvp",
        }),
        row({
          provider: "stripe",
          livemode: true,
          status: "active",
          planCode: "basic",
        }),
      ],
      expectedLivemode: true,
      now: NOW,
    });
    assert.equal(result.allowed, true);
    assert.equal(result.source, "stripe");
    assert.equal(result.planCode, "basic");
  });

  it("does not grant Stripe entitlement when mode is unset", () => {
    const result = resolveEntitlement({
      subscriptions: [
        row({ provider: "stripe", livemode: true, status: "active" }),
      ],
      expectedLivemode: null,
      now: NOW,
    });
    assert.equal(result.allowed, false);
  });
});

describe("billing entitlement gate", () => {
  it("keeps billing recovery paths available without entitlement", () => {
    for (const pathname of [
      "/settings/billing",
      "/api/billing/subscription",
      "/api/billing/checkout-session",
      "/api/billing/portal-session",
      "/auth/login",
      "/onboarding",
      "/ayuda",
      "/subscription-required",
      "/api/tenant/logo",
    ]) {
      assert.equal(isEntitlementExemptPath(pathname), true, pathname);
      assert.equal(
        commercialEntitlementDecision({
          pathname,
          slug: "acme",
          userId: "user-1",
          tenantId: "tenant-1",
          isMember: true,
          entitlementAllowed: false,
        }),
        "skip",
        pathname
      );
    }
  });

  it("returns subscription_required for an operational member endpoint", () => {
    const decision = commercialEntitlementDecision({
      pathname: "/api/orders",
      slug: "acme",
      userId: "user-1",
      tenantId: "tenant-1",
      isMember: true,
      entitlementAllowed: false,
    });
    assert.equal(decision, "subscription_required");
    assert.equal(SUBSCRIPTION_REQUIRED_BODY.code, "subscription_required");
    assert.equal(SUBSCRIPTION_REQUIRED_BODY.error, "Subscription required");
    const response = readSource("lib/tenant/operational-context.ts");
    assert.match(response, /status: 402/);
    assert.match(response, /SUBSCRIPTION_REQUIRED_BODY/);
    const proxy = readSource("proxy.ts");
    assert.match(proxy, /commercialEntitlementDecision/);
    assert.match(proxy, /subscriptionRequiredResponse/);
    assert.match(proxy, /\/subscription-required/);
    assert.match(readSource("lib/quotes/guard.ts"), /subscription_required/);
  });

  it("does not expose subscription_required to a non-member", () => {
    assert.equal(
      commercialEntitlementDecision({
        pathname: "/api/orders",
        slug: "acme",
        userId: "user-2",
        tenantId: "tenant-1",
        isMember: false,
        entitlementAllowed: false,
      }),
      "skip"
    );
  });

  it("blocks kiosk work creation without the member subscription screen", () => {
    assert.equal(
      commercialEntitlementDecision({
        pathname: "/api/kiosk/orders",
        slug: "acme",
        userId: null,
        tenantId: "tenant-1",
        isMember: false,
        entitlementAllowed: false,
      }),
      "kiosk_unavailable"
    );
  });

  it("lets owner and admin open billing and keeps checkout owner-only", () => {
    assert.equal(canAccessBillingScreen("owner"), true);
    assert.equal(canAccessBillingScreen("admin"), true);
    for (const role of ["manager", "staff", "viewer", null]) {
      assert.equal(canAccessBillingScreen(role), false);
      assert.equal(canManageBilling(role), false);
    }
    assert.equal(canManageBilling("admin"), false);
    assert.equal(canManageBilling("owner"), true);

    const page = readSource("app/settings/billing/page.tsx");
    const subscriptionRoute = readSource("app/api/billing/subscription/route.ts");
    const checkout = readSource("app/api/billing/checkout-session/route.ts");
    assert.match(page, /canAccessBillingScreen/);
    assert.match(subscriptionRoute, /canAccessBillingScreen/);
    assert.match(checkout, /canManageBilling/);
    assert.match(readSource("app/subscription-required/page.tsx"), /canAccessBillingScreen/);
    assert.match(
      readSource("app/subscription-required/page.tsx"),
      /Contacta con un administrador de la organización/
    );
  });

  it("allows an internal current subscription to start Stripe checkout", () => {
    const entitlement = resolveEntitlement({
      subscriptions: [
        row({
          provider: "internal",
          status: "active",
          currentPeriodEnd: FUTURE,
        }),
      ],
      expectedLivemode: true,
      now: NOW,
    });
    assert.equal(entitlement.allowed, true);
    assert.equal(stripeCheckoutBlocked(entitlement), false);
    assert.equal(canManageBilling("owner") && !stripeCheckoutBlocked(entitlement), true);
    const ui = readSource("components/settings/billing-settings.tsx");
    assert.match(ui, /Activar facturación con Stripe/);
    assert.match(ui, /Contratar Gestcopy Basic/);
    assert.match(readSource("app/api/billing/subscription/route.ts"), /internalPeriodIsCurrent/);
  });

  it("blocks a second checkout while Stripe is current", () => {
    const entitlement = resolveEntitlement({
      subscriptions: [
        row({ provider: "stripe", livemode: true, status: "active" }),
      ],
      expectedLivemode: true,
      now: NOW,
    });
    assert.equal(stripeCheckoutBlocked(entitlement), true);
    assert.match(
      readSource("app/api/billing/subscription/route.ts"),
      /can_checkout: canCheckout/
    );
  });

  it("keeps provisioning on tenants.active and does not hardcode tenant slugs", () => {
    const currentTenant = readSource("lib/tenant/current-tenant.ts");
    assert.match(currentTenant, /\.eq\("active", true\)/);
    const sources = [
      "lib/billing/entitlement.ts",
      "lib/billing/entitlement-access.ts",
      "lib/billing/entitlement-paths.ts",
      "lib/tenant/operational-context.ts",
      "app/subscription-required/page.tsx",
      "proxy.ts",
    ].map((file) => readSource(file));
    for (const source of sources) {
      assert.doesNotMatch(source, /sur4/i);
      assert.doesNotMatch(source, /\bdemo\b/i);
      assert.doesNotMatch(source, /tenants\.active\s*=/);
    }
    assert.match(
      readSource("lib/billing/entitlement-access.ts"),
      /\.eq\("tenant_id", tenantId\)/
    );
    assert.match(
      readSource("lib/billing/entitlement-access.ts"),
      /\.eq\("active", true\)/
    );
  });
});
