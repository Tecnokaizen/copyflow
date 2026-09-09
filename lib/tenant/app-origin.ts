import "server-only";

import { TENANT_BASE_DOMAIN } from "@/lib/tenant/domains";

const DEFAULT_APP_ORIGIN = `https://${TENANT_BASE_DOMAIN}`;

/**
 * Canonical origin for app-wide server links (invitations, etc.).
 * Prefer APP_BASE_URL in local/preview; default to production apex.
 * Server-only: keeps APP_BASE_URL and invitation URL builders out of client bundles.
 */
export function appOrigin() {
  const configured = process.env.APP_BASE_URL?.trim();

  if (!configured) {
    return DEFAULT_APP_ORIGIN;
  }

  try {
    const url = new URL(configured);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return DEFAULT_APP_ORIGIN;
    }
    return url.origin;
  } catch {
    return DEFAULT_APP_ORIGIN;
  }
}

export function invitationAcceptUrl(token: string) {
  return `${appOrigin()}/invitations/accept?token=${encodeURIComponent(token)}`;
}
