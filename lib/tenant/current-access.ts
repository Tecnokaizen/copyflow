import { createClient } from "@/lib/supabase/server";
import { resolveCurrentAccess, type AccessMembership, type AccessTenant } from "@/lib/tenant/access";
import { resolveRequestTenantSlug } from "@/lib/tenant/request-host";

export async function readCurrentAccess() {
  const supabase = await createClient();

  return resolveCurrentAccess({
    async getUser() {
      const { data, error } = await supabase.auth.getUser();
      return { user: data.user, error };
    },
    resolveSlug: resolveRequestTenantSlug,
    async loadTenant(slug) {
      const { data, error } = await supabase
        .from("tenants")
        .select("id, name, slug")
        .eq("slug", slug)
        .eq("active", true)
        .maybeSingle();
      return { data: data as AccessTenant | null, error };
    },
    async loadMembership(userId, tenantId) {
      const { data, error } = await supabase
        .from("memberships")
        .select("tenant_id, role, active")
        .eq("user_id", userId)
        .eq("tenant_id", tenantId)
        .eq("active", true)
        .maybeSingle();
      return {
        data: data
          ? ({ role: data.role, active: data.active } satisfies AccessMembership)
          : null,
        error,
      };
    },
  });
}
