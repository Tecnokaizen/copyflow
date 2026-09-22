import { createClient } from "@/lib/supabase/server";
import { resolveRequestTenantSlug } from "@/lib/tenant/request-host";

/**
 * Resolves the tenant for the current request host.
 *
 * Paid onboarding creates tenants with `active=false` until a verified Stripe
 * webhook activates them. Normal tenant application context requires
 * `tenants.active = true`. This gate is administrative/provisioning state only
 * and must stay separate from `subscriptions.status`.
 */
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
    .eq("active", true)
    .maybeSingle();

  if (error || !tenant) {
    return null;
  }

  return tenant;
}
