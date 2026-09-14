import type { SupabaseClient } from "@supabase/supabase-js";
import type { TeamAccessUser } from "@/lib/team/link";
import { unwrapRpcPayload } from "@/lib/team/types";

type MemberLink = {
  id: string;
  user_id: string | null;
};

function memberByUserMap(links: MemberLink[]) {
  const memberByUser = new Map<string, string>();
  for (const link of links) {
    if (link.user_id) {
      memberByUser.set(link.user_id, link.id);
    }
  }
  return memberByUser;
}

export function mapTenantDirectoryUsers(
  data: unknown,
  links: MemberLink[]
): TeamAccessUser[] {
  const record = unwrapRpcPayload(data);
  const rows = Array.isArray(record.users)
    ? record.users
    : Array.isArray(data)
      ? data
      : [];
  const memberByUser = memberByUserMap(links);

  return rows.flatMap((row) => {
    if (!row || typeof row !== "object") {
      return [];
    }
    const recordRow = row as Record<string, unknown>;
    const userId =
      typeof recordRow.user_id === "string" ? recordRow.user_id : null;
    const role = typeof recordRow.role === "string" ? recordRow.role : null;
    if (!userId || !role) {
      return [];
    }

    return [
      {
        user_id: userId,
        full_name:
          typeof recordRow.full_name === "string" ? recordRow.full_name : null,
        email: typeof recordRow.email === "string" ? recordRow.email : null,
        role,
        active: recordRow.active === true,
        team_member_id: memberByUser.get(userId) ?? null,
      },
    ];
  });
}

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
  const { data: directory, error: directoryError } = await supabase.rpc(
    "list_tenant_user_directory",
    { p_tenant_id: tenantId }
  );

  if (!directoryError && directory) {
    return mapTenantDirectoryUsers(directory, links);
  }

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

  const memberByUser = memberByUserMap(links);

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
        email: null,
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
    .select("id, name, user_id, job_title, department, active")
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
        job_title: typeof row.job_title === "string" ? row.job_title : null,
        department: typeof row.department === "string" ? row.department : null,
        active: row.active !== false,
      },
    ];
  });
}
