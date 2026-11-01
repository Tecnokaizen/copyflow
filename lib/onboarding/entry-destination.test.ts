import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { getSafeNextPath } from "@/lib/auth/safe-next-path";
import {
  buildOnboardingEntryUrl,
  resolveBillingReturnOrigins,
  type BillingReturnEnv,
} from "@/lib/billing/return-origins";
import { requiresLoginRedirect } from "@/lib/supabase/proxy";
import { parsePreviewTenantSlug, PREVIEW_TENANT_QUERY } from "@/lib/tenant/preview-tenant";
import { safeOnboardingEntryUrl, type EntryPageLocation } from "./entry-destination";

const BRANCH = "copyflow-git-gestcopy-staging-tecnokaizen.vercel.app";
const SLUG = "s10-retornos-1031";

const previewEnv: BillingReturnEnv = {
  VERCEL: "1", VERCEL_ENV: "preview", NODE_ENV: "production", STRIPE_MODE: "test",
  VERCEL_BRANCH_URL: BRANCH,
  VERCEL_URL: "copyflow-test-tecnokaizen.vercel.app",
  TENANT_PREVIEW_BASE_DOMAIN: "preview.app.gestcopy.com",
  BILLING_RETURN_APP_ORIGIN: `https://${BRANCH}`,
};
const productionEnv: BillingReturnEnv = { VERCEL_ENV: "production", STRIPE_MODE: "live" };

function page(origin: string): EntryPageLocation {
  const url = new URL(origin);
  return { origin: url.origin, protocol: url.protocol, hostname: url.hostname, port: url.port };
}
function serverEntry(env: BillingReturnEnv, slug = SLUG) {
  const result = resolveBillingReturnOrigins(env);
  assert.ok(result.ok, JSON.stringify(result));
  return buildOnboardingEntryUrl(result.origins, slug);
}

const productionPage = page("https://app.gestcopy.com");
const stagingPage = page(`https://${BRANCH}`);
const localPage = page("http://localhost:3000");

describe("onboarding entry destination: browser check", () => {
  it("Production app page accepts only the real tenant login", () => {
    const url = `https://${SLUG}.app.gestcopy.com/auth/login`;
    assert.equal(safeOnboardingEntryUrl(url, SLUG, productionPage), url);
    assert.equal(safeOnboardingEntryUrl(serverEntry(productionEnv), SLUG, productionPage), url);
    for (const bad of [
      `https://${BRANCH}/?tenant=${SLUG}`,
      `https://other.app.gestcopy.com/auth/login`,
      `http://${SLUG}.app.gestcopy.com/auth/login`,
      `https://${SLUG}.app.gestcopy.com:8443/auth/login`,
      `https://${SLUG}.app.gestcopy.com/auth/login?next=//evil.example`,
      `https://${SLUG}.app.gestcopy.com/auth/login#x`,
      `https://${SLUG}.app.gestcopy.com/`,
      `https://u:p@${SLUG}.app.gestcopy.com/auth/login`,
      `https://${SLUG}.app.gestcopy.com.evil.example/auth/login`,
      `https://evil.example/auth/login`,
      `//${SLUG}.app.gestcopy.com/auth/login`,
    ]) {
      assert.equal(safeOnboardingEntryUrl(bad, SLUG, productionPage), null, bad);
    }
  });

  it("Staging page stays on its own origin and refuses every Production host (S10 regression)", () => {
    const url = `https://${BRANCH}/?tenant=${SLUG}`;
    assert.equal(safeOnboardingEntryUrl(url, SLUG, stagingPage), url);
    assert.equal(safeOnboardingEntryUrl(serverEntry(previewEnv), SLUG, stagingPage), url);
    // What the page did before: Production tenant login from a Staging page.
    assert.equal(safeOnboardingEntryUrl(serverEntry(productionEnv), SLUG, stagingPage), null);
    for (const bad of [
      `https://${SLUG}.app.gestcopy.com/auth/login`,
      `https://app.gestcopy.com/?tenant=${SLUG}`,
      `https://copyflow-test-tecnokaizen.vercel.app/?tenant=${SLUG}`,
      `https://${SLUG}.preview.app.gestcopy.com/?tenant=${SLUG}`,
      `http://${BRANCH}/?tenant=${SLUG}`,
      `https://${BRANCH}/?tenant=other`,
      `https://${BRANCH}/?tenant=${SLUG}&next=//evil.example`,
      `https://${BRANCH}/?slug=${SLUG}`,
      `https://${BRANCH}/auth/login?tenant=${SLUG}`,
      `https://${BRANCH}/?tenant=${SLUG}#x`,
      `https://${BRANCH}.evil.example/?tenant=${SLUG}`,
      `/?tenant=${SLUG}`,
      `javascript:alert(1)`,
    ]) {
      assert.equal(safeOnboardingEntryUrl(bad, SLUG, stagingPage), null, bad);
    }
  });

  it("local development accepts only the local tenant login", () => {
    const url = "http://acme.localhost:3000/auth/login";
    assert.equal(safeOnboardingEntryUrl(url, "acme", localPage), url);
    assert.equal(safeOnboardingEntryUrl(url, "acme", page("http://127.0.0.1:3000")), url);
    assert.equal(safeOnboardingEntryUrl("https://acme.app.gestcopy.com/auth/login", "acme", localPage), null);
    assert.equal(safeOnboardingEntryUrl("http://acme.localhost:4000/auth/login", "acme", localPage), null);
  });

  it("refuses missing values, non-strings and unsafe slugs", () => {
    for (const raw of [undefined, null, 42, {}, ""]) {
      assert.equal(safeOnboardingEntryUrl(raw, SLUG, stagingPage), null);
    }
    for (const slug of [undefined, "", "../evil", "a&tenant=b", "UPPER", "a".repeat(64)]) {
      assert.equal(safeOnboardingEntryUrl(`https://${BRANCH}/?tenant=${String(slug)}`, slug, stagingPage), null);
    }
  });
});

describe("onboarding entry destination: no authentication loop on Staging", () => {
  // Mirrors applyPreviewTenantOverride; the source check below keeps it honest.
  function previewOverride(url: URL): URL | null {
    const slug = parsePreviewTenantSlug(url.searchParams.get(PREVIEW_TENANT_QUERY) ?? url.searchParams.get("slug"));
    if (!slug) return null;
    const next = new URL(url);
    next.searchParams.delete(PREVIEW_TENANT_QUERY);
    next.searchParams.delete("slug");
    return next;
  }

  it("the proxy strips ?tenant= and redirects, as mirrored here", () => {
    const proxy = readFileSync("lib/supabase/proxy.ts", "utf8");
    assert.match(proxy, /url\.searchParams\.delete\(PREVIEW_TENANT_QUERY\)/);
    assert.match(proxy, /url\.searchParams\.delete\("slug"\)/);
    assert.match(proxy, /cookies\.set\(PREVIEW_TENANT_COOKIE, slug/);
    // Login check runs first, override second.
    assert.ok(proxy.indexOf("requiresLoginRedirect({") < proxy.indexOf("applyPreviewTenantOverride(request, bridge)"));
  });

  for (const hasUser of [true, false]) {
    it(`entry settles on "/" within two proxy hops (${hasUser ? "with" : "without"} session)`, () => {
      let url = new URL(serverEntry(previewEnv));
      const seen: string[] = [];
      for (let hop = 0; hop < 5; hop += 1) {
        seen.push(url.toString());
        if (requiresLoginRedirect({ pathname: url.pathname, hasUser, isApiRoute: false })) {
          const next = getSafeNextPath(`${url.pathname}${url.search}`);
          url = new URL(next, url);
          continue;
        }
        const redirected = previewOverride(url);
        if (!redirected) break;
        url = redirected;
      }
      assert.equal(url.toString(), `https://${BRANCH}/`, seen.join(" -> "));
      assert.ok(seen.length <= 2, seen.join(" -> "));
      assert.equal(new Set(seen).size, seen.length, "no URL repeats");
    });
  }

  it("a later login keeps the tenant entry as a safe relative next path", () => {
    assert.equal(getSafeNextPath(`/?tenant=${SLUG}`), `/?tenant=${SLUG}`);
    assert.equal(parsePreviewTenantSlug(SLUG), SLUG);
  });

  it("the tenant home never sends the user back to onboarding", () => {
    const home = readFileSync("app/page.tsx", "utf8");
    assert.doesNotMatch(home, /redirect\(\s*["'`]\/onboarding/);
  });
});

describe("onboarding entry destination: wiring", () => {
  it("success page uses the server entry URL, checked in the browser, and never builds a host", () => {
    const success = readFileSync("components/onboarding/onboarding-success-status.tsx", "utf8");
    assert.match(success, /safeOnboardingEntryUrl\(\s*body\.tenant\.entry_url,\s*body\.tenant\.slug,\s*window\.location\s*\)/);
    assert.match(success, /window\.location\.assign\(entryUrl\)/);
    assert.doesNotMatch(success, /resolveTenantOrigin|tenantOrigin\(|tenantRequestContextFromLocation/);
    assert.doesNotMatch(success, /app\.gestcopy\.com/);
  });

  it("status route builds the entry from server configuration only, once active", () => {
    const status = readFileSync("app/api/onboarding/status/route.ts", "utf8");
    assert.match(status, /state === "active" && typeof tenant\.slug === "string"\s*\?\s*onboardingEntryUrl\(request, tenant\.slug\)/);
    assert.match(status, /entry_url: entryUrl/);
    assert.ok(status.indexOf('.from("tenants")') < status.indexOf("onboardingEntryUrl(request"));
    assert.doesNotMatch(status, /headers\.get\(\s*["'](host|x-forwarded-host)["']/i);
  });

  it("server adapter reuses the #177 resolver and keeps development local", () => {
    const adapter = readFileSync("lib/billing/return-urls.ts", "utf8");
    const fn = adapter.slice(adapter.indexOf("export function onboardingEntryUrl"));
    assert.match(fn, /assertBillingReturnConfig\(\)/);
    assert.match(fn, /buildOnboardingEntryUrl\(resolved, tenantSlug\)/);
    assert.match(fn, /isLocalDevHostname\(new URL\(resolved\.appOrigin\)\.hostname\)/);
  });
});
