export const SUBSCRIPTION_REQUIRED_BODY = {
  error: "Subscription required",
  code: "subscription_required",
} as const;

/**
 * Paths that stay reachable without a commercial entitlement.
 * Operational APIs and pages are everything else on a tenant host.
 *
 * Kiosk creates tenant work without a member session. It is not exempt:
 * the proxy answers with the existing public unavailable response instead of
 * the member subscription screen.
 * /api/tenant/logo stays open so the billing recovery screen can render the
 * organization mark. It does not create operational work.
 */
export function isEntitlementExemptPath(pathname: string) {
  return (
    pathname.startsWith("/auth/") ||
    pathname === "/auth" ||
    pathname.startsWith("/onboarding") ||
    pathname === "/ayuda" ||
    pathname.startsWith("/ayuda/") ||
    pathname === "/subscription-required" ||
    pathname.startsWith("/subscription-required/") ||
    pathname === "/tenant-inactive" ||
    pathname.startsWith("/tenant-inactive/") ||
    pathname.startsWith("/invitations/") ||
    pathname === "/settings/billing" ||
    pathname.startsWith("/settings/billing/") ||
    pathname === "/api/billing/subscription" ||
    pathname === "/api/billing/checkout-session" ||
    pathname === "/api/billing/portal-session" ||
    pathname === "/api/context" ||
    pathname.startsWith("/api/context/") ||
    pathname.startsWith("/api/onboarding") ||
    pathname.startsWith("/api/webhooks/") ||
    pathname.startsWith("/api/invitations/") ||
    pathname.startsWith("/api/internal/") ||
    pathname.startsWith("/api/auth") ||
    pathname === "/api/tenant/logo"
  );
}

export function isKioskEntitlementPath(pathname: string) {
  return pathname === "/kiosk" || pathname.startsWith("/kiosk/") || pathname.startsWith("/api/kiosk/");
}

export type CommercialEntitlementDecision =
  | "allow"
  | "skip"
  | "subscription_required"
  | "kiosk_unavailable";

/**
 * Pure HTTP decision for the proxy gate.
 * Non-members and unauthenticated requests are skipped so billing state is not leaked.
 * A failed entitlement lookup (null) fails closed for a confirmed member or for kiosk.
 */
export function commercialEntitlementDecision(input: {
  pathname: string;
  slug: string | null;
  userId: string | null;
  tenantId: string | null;
  isMember: boolean;
  entitlementAllowed: boolean | null;
}): CommercialEntitlementDecision {
  if (!input.slug || isEntitlementExemptPath(input.pathname)) {
    return "skip";
  }

  if (isKioskEntitlementPath(input.pathname)) {
    if (!input.tenantId) {
      return "skip";
    }
    return input.entitlementAllowed === true ? "allow" : "kiosk_unavailable";
  }

  if (!input.userId || !input.tenantId || !input.isMember) {
    return "skip";
  }

  return input.entitlementAllowed === true ? "allow" : "subscription_required";
}
