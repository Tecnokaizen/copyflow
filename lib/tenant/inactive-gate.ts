import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { InactiveTenantReason } from "@/lib/tenant/inactive-reason";

export type { InactiveTenantReason };

/**
 * Resolve why a tenant host is inactive.
 * null = tenant missing or active (no inactive gate).
 */
export async function resolveInactiveTenantState(
  supabase: SupabaseClient,
  slug: string
): Promise<InactiveTenantReason | null> {
  const { data, error } = await supabase
    .from("tenants")
    .select("active, provisioning_state")
    .eq("slug", slug)
    .maybeSingle();

  if (error || !data || data.active !== false) {
    return null;
  }

  if (data.provisioning_state === "pending_billing") {
    return "pending_billing";
  }

  return "administratively_disabled";
}

/** True when the hostname resolves to an inactive tenant. */
export async function isInactiveTenantSlug(
  supabase: SupabaseClient,
  slug: string
): Promise<boolean> {
  return (await resolveInactiveTenantState(supabase, slug)) !== null;
}

export function isTenantAppExemptPath(pathname: string) {
  return (
    pathname.startsWith("/api/") ||
    pathname.startsWith("/auth/") ||
    pathname === "/tenant-inactive" ||
    pathname.startsWith("/tenant-inactive/") ||
    pathname === "/kiosk" ||
    pathname.startsWith("/kiosk/") ||
    pathname.startsWith("/invitations/") ||
    pathname === "/ayuda" ||
    pathname.startsWith("/ayuda/")
  );
}
