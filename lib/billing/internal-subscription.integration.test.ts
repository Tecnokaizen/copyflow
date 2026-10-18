import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, it } from "node:test";

/**
 * Runs the real POST /api/billing/checkout-session handler, checkout.ts,
 * current-subscription.ts and supabase-js in a react-server child process.
 * Only the session context and the HTTP layer (PostgREST) are faked, so the
 * assertions cover the exact queries sent and their order. Stripe is never
 * reached: every scenario stops at the guard or at the prepare RPC.
 */

const root = path.join(import.meta.dirname, "../..");
const HOST_TENANT = "aaaaaaaa-0132-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_TENANT = "22222222-2222-4222-8222-222222222222";

type ProbeRequest = {
  method: string;
  path: string;
  query: Record<string, string>;
  body: Record<string, unknown> | null;
};

type ProbeResult = {
  name: string;
  status?: number;
  body?: { error?: string; code?: string };
  thrown?: { name: string; code: string | null };
  requests: ProbeRequest[];
};

const probe = `
  import { mock } from "node:test";
  import { pathToFileURL } from "node:url";
  import path from "node:path";

  const root = process.env.PROBE_ROOT;
  const scenarios = JSON.parse(process.env.PROBE_SCENARIOS);
  let current = null;
  let requests = [];

  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    const method = String(init.method ?? input.method ?? "GET").toUpperCase();
    const body = typeof init.body === "string" ? JSON.parse(init.body) : null;
    requests.push({
      method,
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      body,
    });
    const reply = (status, payload) =>
      new Response(JSON.stringify(payload), {
        status,
        headers: { "content-type": "application/json" },
      });
    if (url.pathname === "/rest/v1/subscriptions" && method === "GET") {
      return current.subscriptionsError
        ? reply(500, { message: "fixture failure", code: "XX000" })
        : reply(200, current.rows);
    }
    if (url.pathname === "/rest/v1/rpc/prepare_billing_checkout_attempt_v2") {
      return reply(200, current.prepare);
    }
    return reply(418, { message: "unexpected request in probe" });
  };

  mock.module(
    pathToFileURL(path.join(root, "lib/tenant/current-context.ts")).href,
    { namedExports: { getCurrentContext: async () => current.context } }
  );

  const { POST } = await import(
    pathToFileURL(path.join(root, "app/api/billing/checkout-session/route.ts")).href
  );
  const { NextRequest } = await import("next/server");
  const { createCheckoutSessionForTenant } = await import(
    pathToFileURL(path.join(root, "lib/billing/checkout.ts")).href
  );

  const results = [];
  for (const scenario of scenarios) {
    current = scenario;
    requests = [];
    const request = new NextRequest(
      "https://tenant-fixture.gestcopy.example/api/billing/checkout-session",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(scenario.requestBody),
      }
    );
    if (scenario.direct) {
      try {
        await createCheckoutSessionForTenant({
          request,
          tenantId: scenario.direct.tenantId,
          tenantSlug: "tenant-fixture",
          planCode: "basic",
          billingInterval: "month",
          flow: scenario.direct.flow,
        });
        results.push({ name: scenario.name, thrown: null, requests });
      } catch (error) {
        results.push({
          name: scenario.name,
          thrown: { name: error.name, code: error.code ?? null },
          requests,
        });
      }
      continue;
    }
    const response = await POST(request);
    results.push({
      name: scenario.name,
      status: response.status,
      body: await response.json(),
      requests,
    });
  }
  process.stdout.write(JSON.stringify(results));
`;

const owner = {
  tenant: { id: HOST_TENANT, slug: "tenant-fixture", name: "Tenant Fixture" },
  membership: { role: "owner" },
  user: { id: "33333333-3333-4333-8333-333333333333", email: "owner@example.com" },
};

const validBody = { plan_code: "basic", billing_interval: "month" };

/** Internal trial whose period ended (e.g. 02/11/2026 13:53 UTC) but is still trialing. */
const expiredTrial = {
  provider: "internal",
  status: "trialing",
  current_period_end: "2026-11-02T13:53:09.342441+00:00",
};

const scenarios = [
  {
    name: "internal-expired-period",
    context: owner,
    requestBody: validBody,
    rows: [expiredTrial],
  },
  {
    name: "internal-ready-for-checkout",
    context: owner,
    requestBody: validBody,
    rows: [
      {
        provider: "internal",
        status: "active",
        metadata: { billing_activation: "ready_for_checkout" },
      },
    ],
    // Stop before Stripe: only checks that the guard lets it reach prepare.
    prepare: { outcome: "checkout_processing", code: "checkout_processing" },
  },
  {
    name: "provider-null-past-due",
    context: owner,
    requestBody: validBody,
    rows: [{ provider: null, status: "past_due" }],
  },
  {
    name: "no-current-subscription",
    context: owner,
    requestBody: validBody,
    rows: [],
    prepare: { outcome: "checkout_processing", code: "checkout_processing" },
  },
  {
    name: "stripe-current",
    context: owner,
    requestBody: validBody,
    rows: [{ provider: "stripe", status: "active" }],
    prepare: {
      outcome: "current_subscription_exists",
      code: "current_subscription_exists",
    },
  },
  {
    // App guard saw nothing (row created after it ran); prepare re-checks in-lock.
    name: "internal-created-after-guard",
    context: owner,
    requestBody: validBody,
    rows: [],
    prepare: {
      outcome: "internal_subscription_current",
      code: "internal_subscription_current",
    },
  },
  {
    name: "lookup-fails",
    context: owner,
    requestBody: validBody,
    subscriptionsError: true,
  },
  {
    name: "body-tenant-id",
    context: owner,
    requestBody: { ...validBody, tenant_id: OTHER_TENANT },
    rows: [],
  },
  {
    name: "non-owner",
    context: { ...owner, membership: { role: "admin" } },
    requestBody: validBody,
    rows: [],
  },
  {
    name: "no-context",
    context: null,
    requestBody: validBody,
    rows: [],
  },
  {
    name: "onboarding-flow",
    context: null,
    requestBody: validBody,
    rows: [expiredTrial],
    direct: { tenantId: HOST_TENANT, flow: "onboarding" },
  },
];

function runProbe(): Map<string, ProbeResult> {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NEXT_PUBLIC_SUPABASE_URL: "http://supabase.fixture.invalid",
    SUPABASE_SECRET_KEY: "fixture-not-a-real-key",
    STRIPE_MODE: "test",
    STRIPE_SECRET_KEY: "sk_test_fixture",
    STRIPE_WEBHOOK_SECRET: "fixture-not-a-real-webhook-secret",
    PROBE_ROOT: root,
    PROBE_SCENARIOS: JSON.stringify(scenarios),
  };
  delete env.SUPABASE_SERVICE_ROLE_KEY;

  const result = spawnSync(
    process.execPath,
    [
      "--conditions=react-server",
      "--experimental-test-module-mocks",
      "--no-warnings",
      "--import",
      "tsx",
      "--input-type=module",
      "--eval",
      probe,
    ],
    { cwd: root, env, encoding: "utf8", timeout: 60_000 }
  );
  assert.equal(result.status, 0, result.stderr || "checkout guard probe failed");
  const results = JSON.parse(result.stdout) as ProbeResult[];
  return new Map(results.map((entry) => [entry.name, entry]));
}

function assertGuardQuery(request: ProbeRequest | undefined) {
  assert.ok(request, "guard query missing");
  assert.equal(request.method, "GET");
  assert.equal(request.path, "/rest/v1/subscriptions");
  assert.deepEqual(request.query, {
    select: "provider,status,metadata",
    tenant_id: `eq.${HOST_TENANT}`,
    status: "in.(trialing,active,past_due)",
  });
}

describe("internal subscription checkout guard · integration (route → supabase-js)", () => {
  const results = runProbe();

  function get(name: string) {
    const entry = results.get(name);
    assert.ok(entry, `missing probe result ${name}`);
    return entry;
  }

  for (const name of ["internal-expired-period", "provider-null-past-due"]) {
    it(`${name}: 409 internal_subscription_current before any checkout attempt`, () => {
      const entry = get(name);
      assert.equal(entry.status, 409);
      assert.equal(entry.body?.code, "internal_subscription_current");
      assert.equal(entry.requests.length, 1, JSON.stringify(entry.requests));
      assertGuardQuery(entry.requests[0]);
    });
  }

  it("internal row marked ready_for_checkout reaches the prepare RPC (D1 option C)", () => {
    const entry = get("internal-ready-for-checkout");
    assert.equal(entry.requests.length, 2, JSON.stringify(entry.requests));
    assertGuardQuery(entry.requests[0]);
    assert.equal(
      entry.requests[1]!.path,
      "/rest/v1/rpc/prepare_billing_checkout_attempt_v2"
    );
  });

  it("guard query carries no date, provider or mode filter", () => {
    const query = get("internal-expired-period").requests[0]!.query;
    assert.deepEqual(Object.keys(query).sort(), ["select", "status", "tenant_id"]);
  });

  it("tenant without subscription keeps the previous flow (prepare RPC decides)", () => {
    const entry = get("no-current-subscription");
    assert.equal(entry.status, 409);
    assert.equal(entry.body?.code, "checkout_processing");
    assert.equal(entry.requests.length, 2);
    assertGuardQuery(entry.requests[0]);
    assert.equal(
      entry.requests[1]!.path,
      "/rest/v1/rpc/prepare_billing_checkout_attempt_v2"
    );
    assert.equal(entry.requests[1]!.body?.p_tenant_id, HOST_TENANT);
    assert.equal(entry.requests[1]!.body?.p_livemode, false);
    assert.equal(entry.requests[1]!.body?.p_flow, "billing");
  });

  it("current Stripe subscription still gets current_subscription_exists", () => {
    const entry = get("stripe-current");
    assert.equal(entry.status, 409);
    assert.equal(entry.body?.code, "current_subscription_exists");
    assert.equal(entry.requests.length, 2);
    assert.equal(
      entry.requests[1]!.path,
      "/rest/v1/rpc/prepare_billing_checkout_attempt_v2"
    );
  });

  it("prepare's in-lock internal check also answers 409 internal_subscription_current", () => {
    const entry = get("internal-created-after-guard");
    assert.equal(entry.status, 409);
    assert.equal(entry.body?.code, "internal_subscription_current");
    assert.equal(entry.requests.length, 2);
    assertGuardQuery(entry.requests[0]);
    assert.equal(
      entry.requests[1]!.path,
      "/rest/v1/rpc/prepare_billing_checkout_attempt_v2"
    );
  });

  it("fails closed when the guard lookup errors", () => {
    const entry = get("lookup-fails");
    assert.equal(entry.status, 500);
    assert.equal(entry.requests.length, 1);
    assertGuardQuery(entry.requests[0]);
  });

  it("rejects tenant_id in the body before touching the database", () => {
    const entry = get("body-tenant-id");
    assert.equal(entry.status, 400);
    assert.deepEqual(entry.requests, []);
  });

  it("only the owner reaches the guard", () => {
    for (const name of ["non-owner", "no-context"]) {
      const entry = get(name);
      assert.equal(entry.status, 403, name);
      assert.deepEqual(entry.requests, [], name);
    }
  });

  it("onboarding flow is guarded by the same check", () => {
    const entry = get("onboarding-flow");
    assert.deepEqual(entry.thrown, {
      name: "CheckoutInternalSubscriptionError",
      code: "internal_subscription_current",
    });
    assert.equal(entry.requests.length, 1);
    assertGuardQuery(entry.requests[0]);
  });
});
