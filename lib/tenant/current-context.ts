import { createClient } from "@/lib/supabase/server";
import { getCurrentTenant } from "@/lib/tenant/current-tenant";

export async function getCurrentContext() {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return null;
  }

  const tenant = await getCurrentTenant();

  if (!tenant) {
    return null;
  }

  const { data: membership, error: membershipError } = await supabase
    .from("memberships")
    .select("tenant_id, role, active")
    .eq("user_id", user.id)
    .eq("tenant_id", tenant.id)
    .eq("active", true)
    .maybeSingle();

  if (membershipError || !membership) {
    return null;
  }

  const metadata = user.user_metadata ?? {};
  const fullName =
    (typeof metadata.full_name === "string" && metadata.full_name.trim()
      ? metadata.full_name
      : typeof metadata.name === "string" && metadata.name.trim()
        ? metadata.name
        : null) ?? null;

  return {
    user: {
      id: user.id,
      email: user.email,
      ...(fullName ? { full_name: fullName } : {}),
    },
    tenant,
    membership: {
      role: membership.role,
      active: membership.active,
    },
  };
}