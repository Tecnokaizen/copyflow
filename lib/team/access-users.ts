import type { SupabaseClient } from "@supabase/supabase-js";
import type { TeamAccessUser } from "@/lib/team/link";

type MemberLink = {
  id: string;
  user_id: string | null;
};

export async function loadTeamMemberLinks(
  supabase: SupabaseClient,
  tenantId: string
): Promise<MemberLink[] | null> {
  const { data, error } = await supabase
    .from("team_members")
    .select("id, user_id")
    .eq("tenant_id", tenantId);

  if (error) {
    console.error("loadTeamMemberLinks", error.message);
    return null;
  }

  return (data ?? []).flatMap((row) => {
    const id = typeof row.id === "string" ? row.id : null;
    if (!id) {
      return [];
    }

    return [
      {
        id,
        user_id: typeof row.user_id === "string" ? row.user_id : null,
      },
    ];
  });
}

export async function loadTenantAccessUsers(
  supabase: SupabaseClient,
  tenantId: string,
  links: MemberLink[]
): Promise<TeamAccessUser[] | null> {
  const { data: memberships, error } = await supabase
    .from("memberships")
    .select("user_id, role, active")
    .eq("tenant_id", tenantId);

  if (error) {
    console.error("loadTenantAccessUsers", error.message);
    return null;
  }

  const userIds = (memberships ?? [])
    .map((row) => (typeof row.user_id === "string" ? row.user_id : null))
    .filter((id): id is string => Boolean(id));

  const profileById = new Map<string, string | null>();

  if (userIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", userIds);

    for (const profile of profiles ?? []) {
      if (typeof profile.id === "string") {
        profileById.set(
          profile.id,
          typeof profile.full_name === "string" ? profile.full_name : null
        );
      }
    }
  }

  const memberByUser = new Map<string, string>();
  for (const link of links) {
    if (link.user_id) {
      memberByUser.set(link.user_id, link.id);
    }
  }

  return (memberships ?? []).flatMap((row) => {
    const userId = typeof row.user_id === "string" ? row.user_id : null;
    const role = typeof row.role === "string" ? row.role : null;
    if (!userId || !role) {
      return [];
    }

    return [
      {
        user_id: userId,
        full_name: profileById.get(userId) ?? null,
        role,
        active: row.active === true,
        team_member_id: memberByUser.get(userId) ?? null,
      },
    ];
  });
}

export async function loadTeamMembersForAccess(
  supabase: SupabaseClient,
  tenantId: string
) {
  const { data, error } = await supabase
    .from("team_members")
    .select("id, name, user_id, active")
    .eq("tenant_id", tenantId)
    .order("name", { ascending: true });

  if (error) {
    console.error("loadTeamMembersForAccess", error.message);
    return null;
  }

  return (data ?? []).flatMap((row) => {
    const id = typeof row.id === "string" ? row.id : null;
    const name = typeof row.name === "string" ? row.name : null;
    if (!id || !name) {
      return [];
    }

    return [
      {
        id,
        name,
        user_id: typeof row.user_id === "string" ? row.user_id : null,
        active: row.active !== false,
      },
    ];
  });
}
