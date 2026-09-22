import "server-only";

import { NextRequest } from "next/server";

import {
  resolveTrustedAppOriginFromHints,
  resolveTrustedTenantOriginFromHints,
  type TrustedOriginHints,
} from "@/lib/tenant/trusted-origin";

function hintsFromRequest(request: NextRequest): TrustedOriginHints {
  return {
    hostHeader: request.headers.get("host"),
    forwardedHostHeader: request.headers.get("x-forwarded-host"),
    forwardedProtoHeader: request.headers.get("x-forwarded-proto"),
    // Vercel Preview/Production run NODE_ENV=production → Gestcopy origins only.
    allowLocalDevelopment: process.env.NODE_ENV === "development",
  };
}

/** Trusted Gestcopy app origin for Stripe/onboarding absolute URLs. */
export function resolveTrustedAppOrigin(request: NextRequest): string {
  return resolveTrustedAppOriginFromHints(hintsFromRequest(request));
}

/** Trusted Gestcopy tenant origin for Billing Checkout/Portal absolute URLs. */
export function resolveTrustedTenantOrigin(
  request: NextRequest,
  tenantSlug: string
): string {
  return resolveTrustedTenantOriginFromHints(
    hintsFromRequest(request),
    tenantSlug
  );
}
