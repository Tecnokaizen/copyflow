import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { isQualifyingActivationStatus } from "./pending-tenant";
import {
  ONBOARDING_PENDING_CODES,
  resolveOnboardingStatusState,
  resolvePendingCommercialTenant,
} from "./pending-tenant";
import {
  resolveTenantOrigin,
  tenantRequestContextFromLocation,
} from "@/lib/tenant/domains";
import { parseInactiveTenantReason } from "@/lib/tenant/inactive-reason";

const root = path.join(import.meta.dirname, "../..");

function readSource(...parts: string[]) {
  return readFileSync(path.join(root, ...parts), "utf8");
}

function mockSupabase(handlers: {
  memberships?: unknown[];
  tenants?: unknown[];
  subscriptions?: unknown[];
  errors?: {
    memberships?: { message: string };
    tenants?: { message: string };
    subscriptions?: { message: string };
  };
}) {
  return {
    from(table: string) {
      const chain: Record<string, unknown> = {};
      const resultFor = () => {
        if (table === "memberships") {
          return {
            data: handlers.memberships ?? [],
            error: handlers.errors?.memberships ?? null,
          };
        }
        if (table === "tenants") {
          return {
            data: handlers.tenants ?? [],
            error: handlers.errors?.tenants ?? null,
          };
        }
        return {
          data: handlers.subscriptions ?? [],
          error: handlers.errors?.subscriptions ?? null,
        };
      };

      for (const method of [
        "select",
        "eq",
        "in",
        "order",
        "limit",
      ] as const) {
        chain[method] = () => chain;
      }
      Object.assign(chain, {
        eq: () => chain,
        in: () => chain,
        select: () => chain,
        then(
          resolve: (value: unknown) => unknown,
          reject?: (reason: unknown) => unknown
        ) {
          try {
            return Promise.resolve(resultFor()).then(resolve, reject);
          } catch (error) {
            return Promise.reject(error).then(resolve, reject);
          }
        },
      });
      return chain;
    },
  };
}

describe("paid onboarding helpers", () => {
  it("qualifying activation statuses are only active and trialing", () => {
    assert.equal(isQualifyingActivationStatus("active"), true);
    assert.equal(isQualifyingActivationStatus("trialing"), true);
    assert.equal(isQualifyingActivationStatus("past_due"), false);
  });

  it("resolves inactive + pending_billing as resumable", async () => {
    const supabase = mockSupabase({
      memberships: [{ tenant_id: "t1" }],
      tenants: [
        {
          id: "t1",
          slug: "acme",
          name: "Acme",
          active: false,
          provisioning_state: "pending_billing",
        },
      ],
      subscriptions: [],
    });

    const result = await resolvePendingCommercialTenant(
      supabase as never,
      "user-1",
      false
    );
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.tenant.slug, "acme");
      assert.equal(result.tenant.provisioning_state, "pending_billing");
    }
  });

  it("does not treat inactive + ready as pending onboarding", async () => {
    const supabase = mockSupabase({
      memberships: [{ tenant_id: "t1" }],
      tenants: [],
      subscriptions: [],
    });

    const result = await resolvePendingCommercialTenant(
      supabase as never,
      "user-1",
      false
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, ONBOARDING_PENDING_CODES.NO_PENDING_TENANT);
    }
  });

  it("fails closed when multiple pending_billing tenants exist", async () => {
    const supabase = mockSupabase({
      memberships: [{ tenant_id: "t1" }, { tenant_id: "t2" }],
      tenants: [
        {
          id: "t1",
          slug: "a",
          name: "A",
          active: false,
          provisioning_state: "pending_billing",
        },
        {
          id: "t2",
          slug: "b",
          name: "B",
          active: false,
          provisioning_state: "pending_billing",
        },
      ],
      subscriptions: [],
    });

    const result = await resolvePendingCommercialTenant(
      supabase as never,
      "user-1",
      false
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(
        result.code,
        ONBOARDING_PENDING_CODES.AMBIGUOUS_PENDING_TENANT
      );
    }
  });

  it("rejects pending tenant that already has a current Stripe subscription", async () => {
    const supabase = mockSupabase({
      memberships: [{ tenant_id: "t1" }],
      tenants: [
        {
          id: "t1",
          slug: "acme",
          name: "Acme",
          active: false,
          provisioning_state: "pending_billing",
        },
      ],
      subscriptions: [
        { id: "s1", provider: "stripe", status: "active", livemode: false },
      ],
    });

    const result = await resolvePendingCommercialTenant(
      supabase as never,
      "user-1",
      false
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(
        result.code,
        ONBOARDING_PENDING_CODES.HAS_COMMERCIAL_SUBSCRIPTION
      );
    }
  });

  it("does not treat opposite-mode Stripe current as blocking pending", async () => {
    const supabase = mockSupabase({
      memberships: [{ tenant_id: "t1" }],
      tenants: [
        {
          id: "t1",
          slug: "acme",
          name: "Acme",
          active: false,
          provisioning_state: "pending_billing",
        },
      ],
      // Mock returns rows regardless of .eq filter; empty means query filtered them out.
      subscriptions: [],
    });

    const result = await resolvePendingCommercialTenant(
      supabase as never,
      "user-1",
      false
    );
    assert.equal(result.ok, true);
  });

  it("onboarding GET/POST require Stripe config and pass expectedLivemode", () => {
    const route = readSource("app/api/onboarding/route.ts");
    assert.match(route, /assertStripeConfig\(\)/);
    assert.match(route, /stripeModeToLivemode\(stripeConfig\.mode\)/);
    assert.match(
      route,
      /resolvePendingCommercialTenant\(\s*supabase,\s*user\.id,\s*expectedLivemode/
    );
    assert.doesNotMatch(route, /getStripeMode\(\)/);
    assert.doesNotMatch(
      route,
      /expectedLivemode\s*=\s*false/
    );
    const pending = readSource("lib/onboarding/pending-tenant.ts");
    assert.doesNotMatch(pending, /getStripeMode/);
    assert.doesNotMatch(pending, /stripeModeToLivemode/);
  });

  it("maps onboarding status states with provisioning_state", () => {
    assert.equal(
      resolveOnboardingStatusState({
        tenantActive: true,
        provisioningState: "ready",
        sessionStatus: "complete",
        paymentStatus: "paid",
        subscriptionStatus: "active",
      }),
      "active"
    );
    assert.equal(
      resolveOnboardingStatusState({
        tenantActive: false,
        provisioningState: "ready",
        sessionStatus: "complete",
        paymentStatus: "paid",
        subscriptionStatus: "active",
      }),
      "disabled"
    );
    assert.equal(
      resolveOnboardingStatusState({
        tenantActive: false,
        provisioningState: "pending_billing",
        sessionStatus: "complete",
        paymentStatus: "paid",
        subscriptionStatus: null,
      }),
      "processing"
    );
    assert.equal(
      resolveOnboardingStatusState({
        tenantActive: false,
        provisioningState: "pending_billing",
        sessionStatus: "open",
        paymentStatus: "unpaid",
        subscriptionStatus: null,
      }),
      "awaiting_payment"
    );
  });

  it("inactive gate reason parsing defaults to administratively_disabled", () => {
    assert.equal(parseInactiveTenantReason("pending_billing"), "pending_billing");
    assert.equal(
      parseInactiveTenantReason("administratively_disabled"),
      "administratively_disabled"
    );
    assert.equal(parseInactiveTenantReason(undefined), "administratively_disabled");
    assert.equal(parseInactiveTenantReason("other"), "administratively_disabled");
  });

  it("onboarding checkout URLs stay on app-host and reject browser tenant_id authority", () => {
    const route = readSource("app/api/onboarding/route.ts");
    assert.match(route, /\/onboarding\/success\?session_id=/);
    assert.doesNotMatch(route, /p_provisioning_mode/);
    assert.doesNotMatch(route, /body\.tenant_id/);
  });

  it("status endpoint correlates session and attempt by livemode", () => {
    const status = readSource("app/api/onboarding/status/route.ts");
    assert.match(status, /checkout_mode_mismatch|CHECKOUT_MODE_MISMATCH_CODE/);
    assert.match(status, /stripeSession\.livemode !== expectedLivemode/);
    assert.match(status, /\.eq\("livemode", expectedLivemode\)/);
    assert.match(status, /select\("id, livemode"\)/);
    const modeIdx = status.indexOf("stripeSession.livemode !== expectedLivemode");
    const membershipIdx = status.indexOf('.from("memberships")');
    assert.ok(modeIdx > 0 && membershipIdx > modeIdx);
  });

  it("status endpoint and inactive UX use provisioning_state", () => {
    const status = readSource("app/api/onboarding/status/route.ts");
    assert.match(status, /provisioning_state/);
    assert.match(status, /resolveOnboardingStatusState/);
    assert.doesNotMatch(status, /activate_tenant_after_billing/);

    const inactive = readSource("app/tenant-inactive/page.tsx");
    assert.match(inactive, /Espacio desactivado/);
    assert.match(inactive, /Espacio pendiente de activación/);
    assert.match(inactive, /parseInactiveTenantReason/);

    const proxy = readSource("proxy.ts");
    assert.match(proxy, /resolveInactiveTenantState/);
    assert.match(proxy, /reason=/);

    const success = readSource(
      "components/onboarding/onboarding-success-status.tsx"
    );
    assert.match(success, /disabled/);
    assert.match(success, /Este espacio está desactivado/);
  });

  it("provisioning_state migration sets pending_billing and blocks Stripe reactivation", () => {
    const migration = readSource(
      "supabase/migrations/20260922152000_tenant_provisioning_state_v1.sql"
    );
    assert.match(migration, /provisioning_state/);
    assert.match(migration, /pending_billing/);
    assert.match(migration, /tenant_not_pending_billing/);
    assert.match(migration, /tenants_pending_billing_requires_inactive/);
    assert.doesNotMatch(migration, /slug = 'demo'/);
    assert.doesNotMatch(migration, /slug = 'sur4'/);

    const workflow = readSource(".github/workflows/kiosk-supabase.yml");
    assert.match(workflow, /phase31_tenant_provisioning_state\.sql/);
  });

  it("local and production success destinations use tenant-aware origin", () => {
    const local = resolveTenantOrigin(
      "billing-sandbox",
      tenantRequestContextFromLocation({
        protocol: "http:",
        hostname: "localhost",
        port: "3000",
      })
    );
    assert.equal(local, "http://billing-sandbox.localhost:3000");
  });
});
