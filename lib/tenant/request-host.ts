import "server-only";

import { cookies, headers } from "next/headers";
import {
  PREVIEW_TENANT_COOKIE,
  isTenantOverrideAllowed,
  parsePreviewTenantSlug,
} from "@/lib/tenant/preview-tenant";
import {
  classifyRequestHost,
  type HostClassification,
} from "@/lib/tenant/trusted-host";

export async function classifyCurrentRequestHost(): Promise<HostClassification> {
  return classifyRequestHost(await headers(), process.env);
}

/**
 * Hostname of the current request, only when it is a trusted app/tenant host.
 * Empty string for untrusted hosts (never reflect unvalidated input).
 */
export async function getRequestHostname() {
  const result = await classifyCurrentRequestHost();
  return result.status === "untrusted" ? "" : result.hostname;
}

/**
 * Resolve tenant slug for the current request.
 * 1) Trusted hostname subdomain (production path) always wins.
 * 2) Preview/local only, and only on a trusted app host: explicit cookie from
 *    ?tenant= / ?slug=. An untrusted host never reaches the override.
 */
export async function resolveRequestTenantSlug(): Promise<string | null> {
  const result = await classifyCurrentRequestHost();

  if (result.status === "tenant") {
    return result.slug;
  }

  if (result.status !== "app" || !isTenantOverrideAllowed()) {
    return null;
  }

  const jar = await cookies();
  return parsePreviewTenantSlug(jar.get(PREVIEW_TENANT_COOKIE)?.value);
}

/** @deprecated Prefer resolveRequestTenantSlug — kept name for call sites that expect hostname-only semantics historically; now includes Preview override. */
export async function getRequestTenantSlug() {
  return resolveRequestTenantSlug();
}

export async function isTenantHostRequest() {
  return (await resolveRequestTenantSlug()) !== null;
}

/**
 * Onboarding pages are reachable only from a trusted app host with no tenant
 * context. Fail closed: an untrusted host is NOT an app host.
 */
export async function isOnboardingHostRequest() {
  const result = await classifyCurrentRequestHost();
  if (result.status !== "app") {
    return false;
  }
  return (await resolveRequestTenantSlug()) === null;
}
