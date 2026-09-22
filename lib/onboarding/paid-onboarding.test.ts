import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { isQualifyingActivationStatus } from "./pending-tenant";
import {
  ONBOARDING_PENDING_CODES,
  resolvePendingCommercialTenant,
} from "./pending-tenant";
import {
  resolveTenantOrigin,
  tenantRequestContextFromLocation,
} from "@/lib/tenant/domains";

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
      // terminal
      (chain as { then?: unknown }).then = undefined;
      Object.assign(chain, {
        eq: () => chain,
        in: () => chain,
        select: () => chain,
        // make awaitable
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
    assert.equal(isQualifyingActivationStatus("incomplete"), false);
    assert.equal(isQualifyingActivationStatus("canceled"), false);
    assert.equal(isQualifyingActivationStatus("paused"), false);
  });

  it("resolves a single pending commercial tenant for resume", async () => {
    const supabase = mockSupabase({
      memberships: [{ tenant_id: "t1" }],
      tenants: [
        { id: "t1", slug: "acme", name: "Acme", active: false },
      ],
      subscriptions: [],
    });

    const result = await resolvePendingCommercialTenant(
      supabase as never,
      "user-1"
    );
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.tenant.slug, "acme");
    }
  });

  it("fails closed when multiple pending tenants exist", async () => {
    const supabase = mockSupabase({
      memberships: [{ tenant_id: "t1" }, { tenant_id: "t2" }],
      tenants: [
        { id: "t1", slug: "a", name: "A", active: false },
        { id: "t2", slug: "b", name: "B", active: false },
      ],
      subscriptions: [],
    });

    const result = await resolvePendingCommercialTenant(
      supabase as never,
      "user-1"
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
        { id: "t1", slug: "acme", name: "Acme", active: false },
      ],
      subscriptions: [{ id: "s1", provider: "stripe", status: "active" }],
    });

    const result = await resolvePendingCommercialTenant(
      supabase as never,
      "user-1"
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(
        result.code,
        ONBOARDING_PENDING_CODES.HAS_COMMERCIAL_SUBSCRIPTION
      );
    }
  });

  it("onboarding checkout URLs stay on app-host and reject browser tenant_id authority", () => {
    const route = readSource("app/api/onboarding/route.ts");
    assert.match(route, /\/onboarding\/success\?session_id=/);
    assert.match(route, /\/onboarding\?canceled=1/);
    assert.doesNotMatch(route, /p_provisioning_mode/);
    assert.match(route, /resume === true/);
    assert.doesNotMatch(route, /tenant_id.*request\.json/);
    assert.doesNotMatch(route, /body\.tenant_id/);

    const checkout = readSource("lib/billing/checkout.ts");
    assert.match(checkout, /successUrl/);
    assert.match(checkout, /cancelUrl/);
    assert.match(checkout, /client_reference_id: input\.tenantId/);
    assert.match(checkout, /tenantHasCurrentStripeSubscription/);
  });

  it("status endpoint validates Stripe session and Owner; session_id alone cannot activate", () => {
    const status = readSource("app/api/onboarding/status/route.ts");
    assert.match(status, /checkout\.sessions\.retrieve/);
    assert.match(status, /role", "owner"/);
    assert.match(status, /tenant\.active === true/);
    assert.doesNotMatch(status, /activate_tenant_after_billing/);
    assert.doesNotMatch(status, /UPDATE tenants/);
  });

  it("webhook activates only after qualifying sync; never deactivates", () => {
    const webhook = readSource("lib/billing/webhook.ts");
    assert.match(webhook, /activateTenantAfterBilling/);
    assert.match(webhook, /isQualifyingActivationStatus/);
    assert.doesNotMatch(webhook, /active:\s*false/);
  });

  it("getCurrentTenant gates on tenants.active = true", () => {
    const source = readSource("lib/tenant/current-tenant.ts");
    assert.match(source, /\.eq\("active", true\)/);
    assert.doesNotMatch(source, /\.from\("subscriptions"\)/);
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
    assert.equal(`${local}/auth/login`, "http://billing-sandbox.localhost:3000/auth/login");

    const prod = resolveTenantOrigin("sur4");
    assert.equal(prod, "https://sur4.app.gestcopy.com");
    assert.equal(`${prod}/auth/login`, "https://sur4.app.gestcopy.com/auth/login");
  });

  it("paid onboarding migration creates inactive commercial tenants and service-only activation", () => {
    const migration = readSource(
      "supabase/migrations/20260922092803_paid_onboarding_v1.sql"
    );
    assert.match(migration, /activate_tenant_after_billing_v1/);
    assert.match(
      migration,
      /GRANT EXECUTE ON FUNCTION public\.activate_tenant_after_billing_v1[\s\S]*service_role/i
    );

    const hardening = readSource(
      "supabase/migrations/20260922095504_paid_onboarding_security_hardening_v1.sql"
    );
    assert.match(hardening, /create_organization \(/);
    assert.doesNotMatch(hardening, /p_provisioning_mode/);
    assert.match(hardening, /create_internal_organization_v1/);
    assert.match(hardening, /is_active_tenant_member/);
    assert.match(hardening, /has_active_tenant_role/);
    assert.match(hardening, /claim_billing_webhook_event_v1/);
    assert.match(hardening, /tenant active is immutable/);
    assert.doesNotMatch(hardening, /slug = 'demo'/);
    assert.doesNotMatch(hardening, /slug = 'sur4'/);
  });
});
