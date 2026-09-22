import { createClient } from "@/lib/supabase/server";
import { resolveRequestTenantSlug } from "@/lib/tenant/request-host";

/**
 * Resolves the tenant for the current request host.
 *
 * Billing note (B2+): paid onboarding will create tenants with `active=false`
 * until a verified Stripe webhook activates them. This helper does not yet
 * filter on `tenants.active`. That gate must stay separate from
 * `subscriptions.status` (commercial state ≠ administrative availability).
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
    .single();

  if (error || !tenant) {
    return null;
  }

  return tenant;
}
