import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  buildBillingReturnUrls, buildOnboardingReturnUrls, checkoutReturnUrlsMatch,
  resolveBillingReturnOrigins, type BillingReturnEnv,
} from "./return-origins";

const preview: BillingReturnEnv = {
  VERCEL: "1", VERCEL_ENV: "preview", NODE_ENV: "production", STRIPE_MODE: "test",
  VERCEL_BRANCH_URL: "copyflow-git-gestcopy-staging-tecnokaizen.vercel.app",
  VERCEL_URL: "copyflow-test-tecnokaizen.vercel.app",
  TENANT_PREVIEW_BASE_DOMAIN: "preview.app.gestcopy.com",
  BILLING_RETURN_APP_ORIGIN: "https://copyflow-git-gestcopy-staging-tecnokaizen.vercel.app",
};
const production: BillingReturnEnv = { VERCEL_ENV: "production", STRIPE_MODE: "live" };
function origins(env: BillingReturnEnv) {
  const result = resolveBillingReturnOrigins(env);
  assert.ok(result.ok, JSON.stringify(result));
  return result.origins;
}
function reject(env: BillingReturnEnv, reason?: string) {
  const result = resolveBillingReturnOrigins(env);
  assert.equal(result.ok, false, JSON.stringify(env));
  if (!result.ok && reason) assert.equal(result.reason, reason);
}

describe("Stripe return origins: environment boundary", () => {
  it("preserves the five Production URLs byte for byte, with Test or Live", () => {
    for (const STRIPE_MODE of ["test", "live"]) {
      for (const configured of [undefined, "https://app.gestcopy.com", "https://app.gestcopy.com/"]) {
        const resolved = origins({ ...production, STRIPE_MODE, BILLING_RETURN_APP_ORIGIN: configured });
        assert.deepEqual(buildOnboardingReturnUrls(resolved), {
          successUrl: "https://app.gestcopy.com/onboarding/success?session_id={CHECKOUT_SESSION_ID}",
          cancelUrl: "https://app.gestcopy.com/onboarding?canceled=1",
        });
        assert.deepEqual(buildBillingReturnUrls(resolved, "sur4"), {
          successUrl: "https://sur4.app.gestcopy.com/settings/billing/success?session_id={CHECKOUT_SESSION_ID}",
          cancelUrl: "https://sur4.app.gestcopy.com/settings/billing?canceled=1",
          portalUrl: "https://sur4.app.gestcopy.com/settings/billing",
        });
      }
    }
  });
  it("rejects every other Production origin", () => {
    for (const value of [preview.BILLING_RETURN_APP_ORIGIN, "https://evil.example", "http://app.gestcopy.com", "https://sur4.app.gestcopy.com", "https://app.gestcopy.com:443"]) {
      reject({ ...production, BILLING_RETURN_APP_ORIGIN: value }, "production_origin_mismatch");
    }
  });
  it("requires explicit Preview configuration, never falling back to Production", () => {
    reject({ ...preview, BILLING_RETURN_APP_ORIGIN: undefined }, "not_configured");
    reject({ ...preview, BILLING_RETURN_APP_ORIGIN: "  " }, "not_configured");
  });
  it("accepts only an exact server supplied platform host or Preview base", () => {
    for (const host of [preview.VERCEL_BRANCH_URL, preview.VERCEL_URL, preview.TENANT_PREVIEW_BASE_DOMAIN]) {
      assert.equal(origins({ ...preview, BILLING_RETURN_APP_ORIGIN: `https://${host}` }).appOrigin, `https://${host}`);
    }
    for (const host of ["app.gestcopy.com", "sur4.app.gestcopy.com", "evil.example", "other.vercel.app", "e2e.preview.app.gestcopy.com"]) {
      reject({ ...preview, BILLING_RETURN_APP_ORIGIN: `https://${host}` }, "preview_origin_not_allowed");
    }
  });
  it("rejects misconfigured system hosts pointing into Production", () => {
    for (const host of ["app.gestcopy.com", "sur4.app.gestcopy.com"]) {
      reject({ ...preview, VERCEL_BRANCH_URL: host, TENANT_PREVIEW_BASE_DOMAIN: host, BILLING_RETURN_APP_ORIGIN: `https://${host}` }, "preview_origin_not_allowed");
    }
  });
  it("rejects credentials, non-https, ports, paths and delimiters even after URL normalisation", () => {
    const host = preview.VERCEL_BRANCH_URL;
    for (const value of [`http://${host}`, `https://u:p@${host}`, `https://@${host}`, `https://${host}:443`, `https://${host}:8443`, `https://${host}/path`, `https://${host}/x/..`, `https://${host}?x=1`, `https://${host}?`, `https://${host}#`, `https://${host}#f`, `https://${host}\\evil`, "invalid"]) {
      reject({ ...preview, BILLING_RETURN_APP_ORIGIN: value }, "invalid_origin");
    }
  });
  it("refuses Live in Preview, local development and unknown environments", () => {
    for (const env of [preview, { NODE_ENV: "development" }, {}, { VERCEL_ENV: "staging" }]) {
      reject({ ...env, STRIPE_MODE: "live" }, "live_requires_production_origin");
    }
    reject({ VERCEL_ENV: "preview", STRIPE_MODE: "bad" }, "invalid_stripe_mode");
    reject({ STRIPE_MODE: "test" }, "environment_not_allowed");
  });
  it("allows local Test only outside Vercel and without configured overrides", () => {
    assert.equal(origins({ NODE_ENV: "development", STRIPE_MODE: "test" }).environment, "development");
    reject({ NODE_ENV: "development", STRIPE_MODE: "test", VERCEL: "1" });
    reject({ NODE_ENV: "development", STRIPE_MODE: "test", BILLING_RETURN_APP_ORIGIN: "https://evil.example" });
  });
  it("ignores manipulated Host and forwarded host data", () => {
    assert.deepEqual(origins({ ...preview, Host: "evil.example", "X-Forwarded-Host": "sur4.app.gestcopy.com" }), origins(preview));
  });
});

describe("Stripe return URL builders and open sessions", () => {
  it("keeps all five returns on Preview, restoring tenant context and the literal session placeholder", () => {
    const resolved = origins(preview);
    const app = resolved.appOrigin;
    assert.deepEqual(buildOnboardingReturnUrls(resolved), {
      successUrl: `${app}/onboarding/success?session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${app}/onboarding?canceled=1`,
    });
    assert.deepEqual(buildBillingReturnUrls(resolved, "d3-pendiente"), {
      successUrl: `${app}/settings/billing/success?tenant=d3-pendiente&session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${app}/settings/billing?tenant=d3-pendiente&canceled=1`,
      portalUrl: `${app}/settings/billing?tenant=d3-pendiente`,
    });
  });
  it("refuses unsafe tenant slugs", () => {
    for (const slug of ["", "../evil", "sur4.evil", "sur4&tenant=evil", "UPPER", "a".repeat(64)]) {
      assert.throws(() => buildBillingReturnUrls(origins(preview), slug), /invalid_tenant_slug/);
    }
  });
  it("keeps validated local tenant origins and ports", () => {
    const local = { ...origins({ NODE_ENV: "development", STRIPE_MODE: "test" }), appOrigin: "http://d3-pendiente.localhost:3000" };
    assert.equal(buildBillingReturnUrls(local, "d3-pendiente").portalUrl, "http://d3-pendiente.localhost:3000/settings/billing");
  });
  it("never reuses an old session with a Production return or the wrong flow/tenant", () => {
    const expected = buildBillingReturnUrls(origins(preview), "d3-pendiente");
    assert.equal(checkoutReturnUrlsMatch({ success_url: expected.successUrl, cancel_url: expected.cancelUrl }, expected), true);
    for (const actual of [buildBillingReturnUrls(origins(production), "d3-pendiente"), buildBillingReturnUrls(origins(preview), "e2e"), buildOnboardingReturnUrls(origins(preview))]) {
      assert.equal(checkoutReturnUrlsMatch({ success_url: actual.successUrl, cancel_url: actual.cancelUrl }, expected), false);
    }
    assert.equal(checkoutReturnUrlsMatch({}, expected), false);
  });
  it("guards routes before acceptance, reservations and tenant creation; validates service callers too", () => {
    for (const path of ["app/api/billing/checkout-session/route.ts", "app/api/billing/portal-session/route.ts", "app/api/onboarding/route.ts"]) {
      const source = readFileSync(path, "utf8");
      assert.match(source, /code: BILLING_RETURN_ORIGIN_ERROR }, 503/);
      const guard = source.indexOf("const returnConfig = assertBillingReturnConfig()");
      const handler = source.slice(source.indexOf("export async function POST"));
      assert.ok(guard >= 0);
      for (const operation of ["await createCheckoutSessionForTenant(", "await createPortalSessionForTenant(", 'await supabase.rpc("create_organization"', "await acceptOfferForCheckout("]) {
        if (handler.includes(operation)) assert.ok(handler.indexOf("assertBillingReturnConfig()") < handler.indexOf(operation), operation);
      }
    }
    const checkout = readFileSync("lib/billing/checkout.ts", "utf8");
    const service = checkout.slice(checkout.indexOf("export async function createCheckoutSessionForTenant"));
    assert.ok(service.indexOf("billingReturnUrls(") < service.indexOf("tenantHasCurrentNonStripeSubscription("));
    assert.match(service, /resolveReusableCheckoutSession\([\s\S]*?returnUrls,/);
  });
});
