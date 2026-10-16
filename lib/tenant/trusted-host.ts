/**
 * Single source of truth for "which host is this request really for?".
 *
 * Pure (no `server-only`, no `next/headers`) so it can be unit tested and used
 * from the proxy, route handlers and server components alike.
 *
 * A host is trusted only when ALL of the following hold:
 * 1. `Host` is present and syntactically valid (strict authority parser).
 * 2. Outside local development, `X-Forwarded-Host` — when present — resolves
 *    to the very same host as `Host`. It is never used on its own.
 * 3. The hostname belongs to an explicitly authorized domain (app base domain,
 *    Preview base domain, Vercel-provided Preview URL, or localhost in local
 *    development). A syntactically valid but unknown/custom domain is
 *    `untrusted`; it is NEVER downgraded to `app`.
 *
 * Callers must treat `untrusted` as "reject", and must NOT interpret a missing
 * tenant slug as "app host" — only `status === "app"` means that.
 *
 * Custom domains (`tenant_domains`) are intentionally not resolved yet; they
 * are therefore classified `untrusted`.
 */

import { authorizeHostname } from "@/lib/tenant/hostname";
import { parseTrustedAuthority } from "@/lib/tenant/trusted-origin";

export type HeaderReader = {
  get(name: string): string | null;
};

export type TrustedHostEnv = {
  VERCEL?: string;
  VERCEL_ENV?: string;
  NODE_ENV?: string;
  TENANT_PREVIEW_BASE_DOMAIN?: string;
  /** Vercel system variables (host only, no scheme). Used in Preview only. */
  VERCEL_URL?: string;
  VERCEL_BRANCH_URL?: string;
};

export type UntrustedHostReason =
  | "missing_host"
  | "malformed_host"
  | "malformed_forwarded_host"
  | "forwarded_host_mismatch"
  | "unexpected_port"
  | "unauthorized_host";

export type HostClassification =
  | { status: "tenant"; hostname: string; slug: string }
  | { status: "app"; hostname: string }
  | { status: "untrusted"; reason: UntrustedHostReason };

function isLocalDevelopment(env: TrustedHostEnv) {
  return (
    env.VERCEL !== "1" &&
    env.VERCEL_ENV !== "production" &&
    env.NODE_ENV === "development"
  );
}

/**
 * Hostname used for comparisons outside local development. Only the default
 * web ports are accepted; anything else is not a legitimate public authority.
 */
function publicHostname(authority: {
  hostname: string;
  port: string | null;
}): string | null {
  if (
    authority.port !== null &&
    authority.port !== "80" &&
    authority.port !== "443"
  ) {
    return null;
  }
  return authority.hostname;
}

function previewPlatformHosts(env: TrustedHostEnv): string[] {
  if (env.VERCEL !== "1" || env.VERCEL_ENV !== "preview") {
    return [];
  }
  return [env.VERCEL_URL, env.VERCEL_BRANCH_URL]
    .map((value) => (typeof value === "string" ? value.trim().toLowerCase() : ""))
    .filter((value) => value.length > 0);
}

export function classifyRequestHost(
  headers: HeaderReader,
  env: TrustedHostEnv = process.env
): HostClassification {
  const hostRaw = headers.get("host");
  if (hostRaw === null || hostRaw.trim() === "") {
    return { status: "untrusted", reason: "missing_host" };
  }

  const host = parseTrustedAuthority(hostRaw);
  if (!host) {
    return { status: "untrusted", reason: "malformed_host" };
  }

  const local = isLocalDevelopment(env);

  if (!local) {
    const hostName = publicHostname(host);
    if (hostName === null) {
      return { status: "untrusted", reason: "unexpected_port" };
    }

    // Header present (even empty) but not identical to Host → spoofed or
    // ambiguous. Local development ignores the header entirely (same rule as
    // Kiosk and trusted-origin), so it cannot influence the result there.
    const forwardedRaw = headers.get("x-forwarded-host");
    if (forwardedRaw !== null) {
      const forwarded = parseTrustedAuthority(forwardedRaw);
      if (!forwarded) {
        return { status: "untrusted", reason: "malformed_forwarded_host" };
      }
      const forwardedName = publicHostname(forwarded);
      if (forwardedName === null || forwardedName !== hostName) {
        return { status: "untrusted", reason: "forwarded_host_mismatch" };
      }
    }
  }

  const hostname = host.hostname;

  if (previewPlatformHosts(env).includes(hostname)) {
    return { status: "app", hostname };
  }

  const authorized = authorizeHostname(hostname, env, { allowLocal: local });
  if (!authorized) {
    return { status: "untrusted", reason: "unauthorized_host" };
  }

  return authorized.kind === "tenant"
    ? { status: "tenant", hostname, slug: authorized.slug }
    : { status: "app", hostname };
}

/** Tenant slug only for a trusted tenant host; null for app AND untrusted. */
export function resolveTrustedTenantSlug(
  headers: HeaderReader,
  env: TrustedHostEnv = process.env
): string | null {
  const result = classifyRequestHost(headers, env);
  return result.status === "tenant" ? result.slug : null;
}

/**
 * True only for a trusted, non-tenant app host. Guards that must be reachable
 * exclusively from the app host (onboarding) must use this, never
 * "slug === null".
 */
export function isTrustedAppHost(
  headers: HeaderReader,
  env: TrustedHostEnv = process.env
): boolean {
  return classifyRequestHost(headers, env).status === "app";
}

/**
 * Exact paths the proxy does not gate on host. Each one never trusts the host
 * for authorization and authenticates by other means, or already enforces a
 * stricter, fail-closed host policy of its own:
 * - `/api/webhooks/stripe`: verified `stripe-signature`, rejected before any work.
 * - `/api/internal/files/cleanup`: `CRON_SECRET` bearer, timing-safe compare.
 * - `/api/kiosk/orders`, `/kiosk`, `/kiosk/`: `trustedKioskRequestContext`
 *   (independent validator; a null context is a 404 before any data access).
 *
 * This is an explicit allow-list on purpose: no prefix or wildcard entries, so a
 * new route under `/api/internal/*`, `/api/kiosk/*` or `/api/webhooks/*` is gated
 * by default until it is reviewed and added here.
 */
export const HOST_GATE_EXEMPT_PATHS: readonly string[] = [
  "/api/webhooks/stripe",
  "/api/internal/files/cleanup",
  "/api/kiosk/orders",
  "/kiosk",
  "/kiosk/",
];

export function isHostGateExemptPath(pathname: string): boolean {
  return HOST_GATE_EXEMPT_PATHS.includes(pathname);
}
