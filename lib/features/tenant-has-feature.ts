import type { SupabaseClient } from "@supabase/supabase-js";

export async function tenantHasFeature(
  supabase: SupabaseClient,
  tenantId: string,
  code: string
) {
  const { data, error } = await supabase.rpc("tenant_has_feature", {
    p_tenant_id: tenantId,
    p_code: code,
  });

  if (error || data !== true) {
    return false;
  }

  return true;
}
