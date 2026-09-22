/**
 * Trusted Gestcopy origins for Stripe redirects and absolute URLs.
 * Pure (no NextRequest / server-only) so unit tests can cover Host-injection cases.
 */

import {
  LOCAL_TENANT_BASE_DOMAIN,
  TENANT_BASE_DOMAIN,
  tenantOrigin,
} from "@/lib/tenant/domains";
import { normalizeHostname } from "@/lib/tenant/hostname";

export const PRODUCTION_APP_ORIGIN = `https://${TENANT_BASE_DOMAIN}`;

export type TrustedOriginHints = {
  hostHeader?: string | null;
  forwardedHostHeader?: string | null;
  forwardedProtoHeader?: string | null;
  /**
   * When true, localhost / 127.0.0.1 / *.localhost may be preserved.
   * Must only be set by the server adapter in real local development.
   */
  allowLocalDevelopment?: boolean;
};

type ParsedAuthority = {
  hostname: string;
  port: string | null;
  canonical: string;
};

/**
 * Strict authority parser. Rejects injection shapes (@, spaces, multi-host, etc.).
 */
export function parseTrustedAuthority(
  raw: string | null | undefined
): ParsedAuthority | null {
  if (!raw) {
    return null;
  }
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 260) {
    return null;
  }
  // Reject multi-value / injection before taking a "first" segment.
  if (
    trimmed.includes(",") ||
    trimmed.includes("@") ||
    trimmed.includes("/") ||
    trimmed.includes(" ")
  ) {
    return null;
  }

  const match = trimmed.match(
    /^((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.?|127\.0\.0\.1)(?::([0-9]{1,5}))?$/i
  );
  if (!match) {
    return null;
  }

  const port = match[2] ?? null;
  if (port !== null) {
    const n = Number(port);
    if (!Number.isInteger(n) || n < 1 || n > 65_535) {
      return null;
    }
  }

  const hostname = normalizeHostname(match[1]);
  return {
    hostname,
    port,
    canonical: port ? `${hostname}:${port}` : hostname,
  };
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1";
}

function isLocalTenantHostname(hostname: string): boolean {
  return (
    hostname !== LOCAL_TENANT_BASE_DOMAIN &&
    hostname.endsWith(`.${LOCAL_TENANT_BASE_DOMAIN}`) &&
    !hostname.slice(0, -(LOCAL_TENANT_BASE_DOMAIN.length + 1)).includes(".")
  );
}

/** Hostnames we may preserve for local protocol/port only. */
export function isTrustedLocalHostname(hostname: string): boolean {
  const host = normalizeHostname(hostname);
  return isLoopbackHostname(host) || isLocalTenantHostname(host);
}

/**
 * Only trust Host when local development is explicitly allowed AND Host is a
 * recognized local authority. Never reflect x-forwarded-host alone (spoofable).
 * If forwarded-host is present and Host is local, ignore a non-matching/evil forwarder.
 */
function resolveTrustedLocalAuthority(
  hints: TrustedOriginHints
): ParsedAuthority | null {
  if (hints.allowLocalDevelopment !== true) {
    return null;
  }

  const host = parseTrustedAuthority(hints.hostHeader);
  if (!host || !isTrustedLocalHostname(host.hostname)) {
    return null;
  }

  const forwarded = parseTrustedAuthority(hints.forwardedHostHeader);
  if (
    forwarded &&
    (!isTrustedLocalHostname(forwarded.hostname) ||
      forwarded.canonical !== host.canonical)
  ) {
    // Host is local; ignore spoofed/mismatched forwarded-host and keep Host.
    return host;
  }

  return host;
}

/** Only http/https; never reflect arbitrary proto strings. */
export function resolveTrustedLocalProtocol(
  forwardedProtoHeader: string | null | undefined
): "http" | "https" {
  if (!forwardedProtoHeader) {
    return "http";
  }
  const raw = forwardedProtoHeader.trim().toLowerCase();
  // Reject multi-value proto lists.
  if (raw.includes(",") || raw.includes(" ")) {
    return "http";
  }
  if (raw === "https") {
    return "https";
  }
  // Local default is http (dev servers). Never reflect ftp/javascript/etc.
  return "http";
}

function localOrigin(authority: ParsedAuthority, proto: "http" | "https") {
  const portSuffix = authority.port ? `:${authority.port}` : "";
  return `${proto}://${authority.hostname}${portSuffix}`;
}

/**
 * App-host origin for onboarding success/cancel and similar app URLs.
 * Production / Preview / unknown / malicious Host → https://app.gestcopy.com
 * Real local development + Host localhost|127.0.0.1 → preserve proto/port
 * Real local development + Host {slug}.localhost → localhost with same port
 */
export function resolveTrustedAppOriginFromHints(
  hints: TrustedOriginHints
): string {
  const local = resolveTrustedLocalAuthority(hints);
  if (!local) {
    return PRODUCTION_APP_ORIGIN;
  }

  const proto = resolveTrustedLocalProtocol(hints.forwardedProtoHeader);

  if (isLoopbackHostname(local.hostname)) {
    return localOrigin(local, proto);
  }

  // Tenant *.localhost request asking for app origin → local app apex + port.
  const portSuffix = local.port ? `:${local.port}` : "";
  return `${proto}://localhost${portSuffix}`;
}

/**
 * Tenant origin for Billing Checkout/Portal return URLs.
 * Production / unknown → https://{slug}.app.gestcopy.com
 * Local trusted Host → http(s)://{slug}.localhost[:port] (port from Host)
 */
export function resolveTrustedTenantOriginFromHints(
  hints: TrustedOriginHints,
  tenantSlug: string
): string {
  const slug = tenantSlug.trim().toLowerCase();
  if (!slug) {
    return PRODUCTION_APP_ORIGIN;
  }

  const local = resolveTrustedLocalAuthority(hints);
  if (!local) {
    return tenantOrigin(slug);
  }

  const proto = resolveTrustedLocalProtocol(hints.forwardedProtoHeader);
  const portSuffix = local.port ? `:${local.port}` : "";
  return `${proto}://${slug}.${LOCAL_TENANT_BASE_DOMAIN}${portSuffix}`;
}
