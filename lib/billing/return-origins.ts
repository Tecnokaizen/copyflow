import { SLUG_PATTERN } from "@/lib/onboarding/slug";
import { PRODUCTION_APP_ORIGIN } from "@/lib/tenant/trusted-origin";
import { tenantOrigin } from "@/lib/tenant/domains";

export const BILLING_RETURN_ORIGIN_ERROR = "billing_return_origin_not_configured";
export type BillingReturnEnv = Record<string, string | undefined>;
export type BillingReturnOrigins = {
  appOrigin: string;
  environment: "production" | "preview" | "development";
};
export type BillingReturnResolution =
  | { ok: true; origins: BillingReturnOrigins }
  | { ok: false; reason: string };

function parseOrigin(raw: string): URL | null {
  try {
    const url = new URL(raw);
    // Check the raw authority too: URL normalisation hides :443, /x/..,
    // empty credentials, and empty query/fragment delimiters.
    if (!/^https:\/\/[a-z0-9.-]+\/?$/i.test(raw) ||
        url.protocol !== "https:" || url.username || url.password || url.port ||
        url.pathname !== "/" || url.search || url.hash) return null;
    return url;
  } catch { return null; }
}

/** Server configuration only. Never accepts request headers or a browser URL. */
export function resolveBillingReturnOrigins(env: BillingReturnEnv): BillingReturnResolution {
  const configured = env.BILLING_RETURN_APP_ORIGIN?.trim();
  const mode = env.STRIPE_MODE?.trim().toLowerCase();
  if (mode !== "test" && mode !== "live") return { ok: false, reason: "invalid_stripe_mode" };
  if (mode === "live" && env.VERCEL_ENV !== "production") {
    return { ok: false, reason: "live_requires_production_origin" };
  }
  if (env.VERCEL_ENV === "production") {
    if (configured && configured !== PRODUCTION_APP_ORIGIN && configured !== `${PRODUCTION_APP_ORIGIN}/`) {
      return { ok: false, reason: "production_origin_mismatch" };
    }
    return { ok: true, origins: { appOrigin: PRODUCTION_APP_ORIGIN, environment: "production" } };
  }
  if (env.VERCEL_ENV === "preview") {
    if (!configured) return { ok: false, reason: "not_configured" };
    const url = parseOrigin(configured);
    if (!url) return { ok: false, reason: "invalid_origin" };
    const allowed = [env.VERCEL_BRANCH_URL, env.VERCEL_URL, env.TENANT_PREVIEW_BASE_DOMAIN]
      .filter((host): host is string => Boolean(host))
      .map((host) => host.trim().toLowerCase());
    // Only the explicit Preview base may sit below the Production suffix.
    // All Production app/tenant domains stay forbidden even if misconfigured
    // as a Vercel system host or as TENANT_PREVIEW_BASE_DOMAIN.
    const previewBase = env.TENANT_PREVIEW_BASE_DOMAIN?.trim().toLowerCase();
    const productionDomain = new URL(PRODUCTION_APP_ORIGIN).hostname;
    const isProduction = url.hostname === productionDomain ||
      (url.hostname.endsWith(`.${productionDomain}`) &&
       !(url.hostname === previewBase && previewBase === `preview.${productionDomain}`));
    if (isProduction || !allowed.includes(url.hostname)) {
      return { ok: false, reason: "preview_origin_not_allowed" };
    }
    return { ok: true, origins: { appOrigin: url.origin, environment: "preview" } };
  }
  if (env.VERCEL !== "1" && env.NODE_ENV === "development" && !configured) {
    // The server adapter supplies the existing, strictly local origin resolver.
    return { ok: true, origins: { appOrigin: "http://localhost", environment: "development" } };
  }
  return { ok: false, reason: "environment_not_allowed" };
}

export function buildOnboardingReturnUrls(origins: BillingReturnOrigins) {
  return {
    successUrl: `${origins.appOrigin}/onboarding/success?session_id={CHECKOUT_SESSION_ID}`,
    cancelUrl: `${origins.appOrigin}/onboarding?canceled=1`,
  };
}

export function buildBillingReturnUrls(origins: BillingReturnOrigins, tenantSlug: string) {
  if (!SLUG_PATTERN.test(tenantSlug) || tenantSlug.length > 63) throw new Error("invalid_tenant_slug");
  const origin = origins.environment === "production" ? tenantOrigin(tenantSlug) : origins.appOrigin;
  const selector = origins.environment === "preview" ? `tenant=${encodeURIComponent(tenantSlug)}` : "";
  const base = `${origin}/settings/billing`;
  return {
    successUrl: `${base}/success?${selector ? `${selector}&` : ""}session_id={CHECKOUT_SESSION_ID}`,
    cancelUrl: `${base}?${selector ? `${selector}&` : ""}canceled=1`,
    portalUrl: `${base}${selector ? `?${selector}` : ""}`,
  };
}

/** Old open sessions must not retain a return to another environment. */
export function checkoutReturnUrlsMatch(
  session: { success_url?: string | null; cancel_url?: string | null },
  expected: { successUrl: string; cancelUrl: string }
): boolean {
  return session.success_url === expected.successUrl && session.cancel_url === expected.cancelUrl;
}
