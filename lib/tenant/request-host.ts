import "server-only";

import { cookies, headers } from "next/headers";
import { getSubdomainFromHostname } from "@/lib/tenant/hostname";
import {
  PREVIEW_TENANT_COOKIE,
  isTenantOverrideAllowed,
  parsePreviewTenantSlug,
} from "@/lib/tenant/preview-tenant";

export async function getRequestHostname() {
  const headersList = await headers();
  return (
    headersList.get("x-forwarded-host") ?? headersList.get("host") ?? ""
  );
}

/**
 * Resolve tenant slug for the current request.
 * 1) Hostname subdomain (production path) always wins.
 * 2) Preview/local only: explicit cookie from ?tenant= / ?slug=.
 */
export async function resolveRequestTenantSlug(): Promise<string | null> {
  const hostnameSlug = getSubdomainFromHostname(await getRequestHostname());
  if (hostnameSlug) {
    return hostnameSlug;
  }

  if (!isTenantOverrideAllowed()) {
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
