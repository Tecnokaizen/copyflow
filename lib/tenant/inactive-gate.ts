import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Returns true when the hostname resolves to an existing tenant that is not
 * yet administratively active (paid onboarding pending).
 */
export async function isInactiveTenantSlug(
  supabase: SupabaseClient,
  slug: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from("tenants")
    .select("active")
    .eq("slug", slug)
    .maybeSingle();

  if (error || !data) {
    return false;
  }

  return data.active === false;
}

export function isTenantAppExemptPath(pathname: string) {
  return (
    pathname.startsWith("/api/") ||
    pathname.startsWith("/auth/") ||
    pathname === "/tenant-inactive" ||
    pathname.startsWith("/tenant-inactive/") ||
    pathname === "/kiosk" ||
    pathname.startsWith("/kiosk/") ||
    pathname.startsWith("/invitations/")
  );
}
