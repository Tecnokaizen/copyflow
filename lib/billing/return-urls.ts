import "server-only";
import type { NextRequest } from "next/server";
import { isLocalDevHostname } from "@/lib/tenant/domains";
import { resolveTrustedAppOrigin, resolveTrustedTenantOrigin } from "@/lib/tenant/request-origin";
import {
  buildBillingReturnUrls,
  buildOnboardingEntryUrl,
  buildOnboardingReturnUrls,
  resolveBillingReturnOrigins,
} from "./return-origins";

export function assertBillingReturnConfig() {
  return resolveBillingReturnOrigins(process.env);
}

function origins() {
  const result = assertBillingReturnConfig();
  if (!result.ok) throw new Error(`billing_return_origin_not_configured:${result.reason}`);
  return result.origins;
}

export function onboardingReturnUrls(request: NextRequest) {
  const resolved = origins();
  if (resolved.environment === "development") {
    resolved.appOrigin = resolveTrustedAppOrigin(request);
  }
  return buildOnboardingReturnUrls(resolved);
}

export function billingReturnUrls(request: NextRequest, tenantSlug: string) {
  const resolved = origins();
  if (resolved.environment === "development") {
    resolved.appOrigin = resolveTrustedTenantOrigin(request, tenantSlug);
  }
  return buildBillingReturnUrls(resolved, tenantSlug);
}

/**
 * Entry URL for the onboarding success page. Null when billing returns are not
 * configured, the slug is invalid, or development cannot resolve a local origin:
 * the page then shows no link instead of guessing a host.
 */
export function onboardingEntryUrl(request: NextRequest, tenantSlug: string): string | null {
  const result = assertBillingReturnConfig();
  if (!result.ok) return null;
  const resolved = { ...result.origins };
  try {
    if (resolved.environment === "development") {
      resolved.appOrigin = resolveTrustedTenantOrigin(request, tenantSlug);
      if (!isLocalDevHostname(new URL(resolved.appOrigin).hostname)) return null;
    }
    return buildOnboardingEntryUrl(resolved, tenantSlug);
  } catch {
    return null;
  }
}
