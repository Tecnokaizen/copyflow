export const SUBSCRIPTION_REQUIRED_BODY = {
  error: "Subscription required",
  code: "subscription_required",
} as const;

export const ENTITLEMENT_UNAVAILABLE_BODY = {
  error: "Commercial access could not be verified",
  code: "entitlement_unavailable",
} as const;

/**
 * Exact paths, or a path plus its children.
 * A prefix match without a path boundary is intentionally not used:
 * `/api/internal/files/cleanup` must not exempt `/api/internal/operational-example`.
 */
type ExemptRule = {
  path: string;
  kind: "exact" | "tree";
  reason: string;
};

export const ENTITLEMENT_EXEMPT_RULES: readonly ExemptRule[] = [
  {
    path: "/auth",
    kind: "tree",
    reason:
      "Sign-in, password recovery and session confirmation happen before a tenant subscription can be evaluated.",
  },
  {
    path: "/onboarding",
    kind: "tree",
    reason:
      "Paid onboarding creates the organization. There is no current subscription to check yet.",
  },
  {
    path: "/ayuda",
    kind: "tree",
    reason: "Public help center. No session and no tenant work.",
  },
  {
    path: "/settings/billing",
    kind: "tree",
    reason:
      "Billing screens, including the Stripe return page, stay open so the owner can subscribe again. Checkout and portal remain owner-only inside those routes.",
  },
  {
    path: "/subscription-required",
    kind: "tree",
    reason: "Screen for a member without a current subscription. Exempt to avoid a redirect loop.",
  },
  {
    path: "/entitlement-unavailable",
    kind: "tree",
    reason:
      "Screen for a technical failure while resolving commercial access. Exempt to avoid a redirect loop. It does not say the subscription is canceled.",
  },
  {
    path: "/tenant-inactive",
    kind: "tree",
    reason: "Provisioning screen. tenants.active is not a billing flag.",
  },
  {
    path: "/invitations/accept",
    kind: "exact",
    reason: "Invite acceptance page. The visitor may not be a member yet.",
  },
  {
    path: "/api/billing/subscription",
    kind: "exact",
    reason: "Owner and admin can read billing while operations are blocked.",
  },
  {
    path: "/api/billing/checkout-session",
    kind: "exact",
    reason: "Owner checkout must stay available without a current entitlement.",
  },
  {
    path: "/api/billing/portal-session",
    kind: "exact",
    reason: "Owner portal must stay available for an existing Stripe customer.",
  },
  {
    path: "/api/context",
    kind: "exact",
    reason:
      "Identity payload for the billing shell. A future child path is operational and stays blocked.",
  },
  {
    path: "/api/onboarding",
    kind: "exact",
    reason: "Creates the organization during paid onboarding.",
  },
  {
    path: "/api/onboarding/status",
    kind: "exact",
    reason: "Onboarding return status. It does not run tenant operations.",
  },
  {
    path: "/api/webhooks/stripe",
    kind: "exact",
    reason:
      "Stripe delivers events without a member session. The route authenticates the signature. Any other webhook must be listed on purpose.",
  },
  {
    path: "/api/invitations/accept",
    kind: "exact",
    reason: "Accept an invite before that person can pass the operational gate.",
  },
  {
    path: "/api/invitations/preview",
    kind: "exact",
    reason: "Token preview before sign-in. No operational write.",
  },
  {
    path: "/api/invitations/signup",
    kind: "exact",
    reason: "Creates the invited account before a subscription check applies to that person.",
  },
  {
    path: "/api/internal/files/cleanup",
    kind: "exact",
    reason:
      "Cron cleanup authenticated by CRON_SECRET, not by a member. It must run across tenants. Other internal routes are blocked.",
  },
  {
    path: "/api/tenant/logo",
    kind: "exact",
    reason:
      "Read-only organization mark used by the billing recovery screen. It does not create operational work.",
  },
];

function ruleMatches(pathname: string, rule: ExemptRule) {
  if (rule.kind === "exact") {
    return pathname === rule.path;
  }
  return pathname === rule.path || pathname.startsWith(`${rule.path}/`);
}

export function isEntitlementExemptPath(pathname: string) {
  return ENTITLEMENT_EXEMPT_RULES.some((rule) => ruleMatches(pathname, rule));
}

export function isKioskEntitlementPath(pathname: string) {
  return (
    pathname === "/kiosk" ||
    pathname.startsWith("/kiosk/") ||
    pathname.startsWith("/api/kiosk/")
  );
}

export type CommercialEntitlementDecision =
  | "allow"
  | "skip"
  | "subscription_required"
  | "entitlement_unavailable"
  | "kiosk_unavailable";

export type EntitlementGateObservation = {
  pathname: string;
  slug: string | null;
  authentication: "anonymous" | "authenticated" | "error";
  tenant: "active" | "absent" | "error";
  membership: "member" | "absent" | "error" | "unchecked";
  entitlement: "allowed" | "denied" | "error" | "unchecked";
};

/**
 * Commercial gate decision.
 * Anonymous users, missing/inactive tenants and confirmed non-members are skipped.
 * A technical error for an authenticated request on a tenant host fails closed.
 * That failure is entitlement_unavailable, not subscription_required.
 * Kiosk fails closed as kiosk_unavailable.
 */
export function commercialEntitlementDecision(
  input: EntitlementGateObservation
): CommercialEntitlementDecision {
  if (!input.slug || isEntitlementExemptPath(input.pathname)) {
    return "skip";
  }

  if (isKioskEntitlementPath(input.pathname)) {
    if (input.tenant === "absent") {
      return "skip";
    }
    return input.entitlement === "allowed" ? "allow" : "kiosk_unavailable";
  }

  if (input.authentication === "anonymous") {
    return "skip";
  }
  if (input.authentication === "error") {
    return "entitlement_unavailable";
  }
  if (input.tenant === "error") {
    return "entitlement_unavailable";
  }
  if (input.tenant === "absent") {
    return "skip";
  }
  if (input.membership === "error") {
    return "entitlement_unavailable";
  }
  if (input.membership !== "member") {
    return "skip";
  }
  if (input.entitlement === "allowed") {
    return "allow";
  }
  if (input.entitlement === "denied") {
    return "subscription_required";
  }
  return "entitlement_unavailable";
}
