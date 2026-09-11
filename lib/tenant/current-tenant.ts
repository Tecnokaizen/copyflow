import { createClient } from "@/lib/supabase/server";
import { resolveRequestTenantSlug } from "@/lib/tenant/request-host";

export async function getCurrentTenant() {
  const slug = await resolveRequestTenantSlug();

  if (!slug) {
    return null;
  }

  const supabase = await createClient();

  const { data: tenant, error } = await supabase
    .from("tenants")
    .select("id, name, slug")
    .eq("slug", slug)
    .single();

  if (error || !tenant) {
    return null;
  }

  return tenant;
}
