import type { SupabaseClient } from "@supabase/supabase-js";

type RelationTable = "clients" | "services" | "team_members" | "quote_statuses";

export async function relationBelongsToTenant(
  supabase: SupabaseClient,
  table: RelationTable,
  id: string,
  tenantId: string
) {
  const { data, error } = await supabase
    .from(table)
    .select("id")
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  return !error && Boolean(data);
}
