import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveMaxFileBytesFromPreferences } from "@/lib/settings/files";
import { resolveQuickOrderLayout } from "@/lib/settings/quick-order-layout";
import { resolveCurrentTeamMember } from "@/lib/team/current-member";

export async function loadOrderOptions(
  supabase: SupabaseClient,
  input: {
    tenantId: string;
    tenantSlug: string;
    userId: string;
    actorRole: string;
  }
) {
  const currentTeamMember = await resolveCurrentTeamMember(
    supabase,
    input.tenantId,
    input.userId
  );

  const [
    servicesResult,
    entryChannelsResult,
    orderContextsResult,
    teamMembersResult,
    storesResult,
    settingsResult,
    fileStatusesResult,
  ] = await Promise.all([
    supabase
      .from("services")
      .select("id, name")
      .eq("tenant_id", input.tenantId)
      .eq("active", true)
      .order("name", { ascending: true }),
    supabase
      .from("entry_channels")
      .select("id, code, name")
      .eq("tenant_id", input.tenantId)
      .eq("active", true)
      .order("sort_order", { ascending: true }),
    supabase
      .from("order_contexts")
      .select("id, code, name")
      .eq("tenant_id", input.tenantId)
      .eq("active", true)
      .order("sort_order", { ascending: true }),
    // Assignable people only: active and able to receive orders, the rule
    // the database enforces (team_member_is_assignable, 20261022130000).
    supabase
      .from("team_members")
      .select("id, name")
      .eq("tenant_id", input.tenantId)
      .eq("active", true)
      .eq("can_receive_orders", true)
      .order("name", { ascending: true }),
    supabase
      .from("stores")
      .select("id, name")
      .eq("tenant_id", input.tenantId)
      .eq("active", true)
      .order("name", { ascending: true }),
    supabase
      .from("tenant_settings")
      .select("preferences, timezone, locale")
      .eq("tenant_id", input.tenantId)
      .maybeSingle(),
    supabase
      .from("file_statuses")
      .select("id, code, name")
      .eq("tenant_id", input.tenantId)
      .eq("active", true)
      .order("sort_order", { ascending: true }),
  ]);

  const firstError =
    servicesResult.error ??
    entryChannelsResult.error ??
    orderContextsResult.error ??
    teamMembersResult.error ??
    storesResult.error ??
    settingsResult.error ??
    fileStatusesResult.error;

  if (firstError) {
    return { ok: false as const, error: firstError };
  }

  return {
    ok: true as const,
    data: {
      tenant: input.tenantSlug,
      services: servicesResult.data ?? [],
      file_statuses: fileStatusesResult.data ?? [],
      max_file_bytes: resolveMaxFileBytesFromPreferences(
        settingsResult.data?.preferences
      ),
      entry_channels: entryChannelsResult.data ?? [],
      order_contexts: orderContextsResult.data ?? [],
      team_members: teamMembersResult.data ?? [],
      stores: storesResult.data ?? [],
      actor_role: input.actorRole,
      actor_id: input.userId,
      current_team_member: currentTeamMember,
      quick_order_layout: resolveQuickOrderLayout(
        settingsResult.data?.preferences
      ),
      timezone:
        typeof settingsResult.data?.timezone === "string"
          ? settingsResult.data.timezone
          : "Europe/Madrid",
      locale:
        typeof settingsResult.data?.locale === "string"
          ? settingsResult.data.locale
          : "es",
    },
  };
}
