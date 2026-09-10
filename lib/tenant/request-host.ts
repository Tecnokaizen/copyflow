import "server-only";

import { headers } from "next/headers";
import { getSubdomainFromHostname } from "@/lib/tenant/hostname";

export async function getRequestHostname() {
  const headersList = await headers();
  return (
    headersList.get("x-forwarded-host") ?? headersList.get("host") ?? ""
  );
}

/** Non-null when the request host is a tenant subdomain ({slug}.app.gestcopy.com). */
export async function getRequestTenantSlug() {
  return getSubdomainFromHostname(await getRequestHostname());
}

export async function isTenantHostRequest() {
  return (await getRequestTenantSlug()) !== null;
}
