import "server-only";
import type { NextRequest } from "next/server";
import { resolveTrustedAppOrigin, resolveTrustedTenantOrigin } from "@/lib/tenant/request-origin";
import {
  buildBillingReturnUrls,
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
