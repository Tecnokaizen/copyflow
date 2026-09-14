import type { SupabaseClient } from "@supabase/supabase-js";

export type CurrentTeamMember = {
  id: string;
  name: string;
};

/**
 * Resolves the operative team_member for the authenticated user in the
 * current tenant via the explicit user_id link. Never matches by name/email.
 */
export async function resolveCurrentTeamMember(
  supabase: SupabaseClient,
  tenantId: string,
  userId: string
): Promise<CurrentTeamMember | null> {
  const { data, error } = await supabase
    .from("team_members")
    .select("id, name")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  const id = typeof data.id === "string" ? data.id : null;
  const name = typeof data.name === "string" ? data.name : null;

  if (!id || !name) {
    return null;
  }

  return { id, name };
}
