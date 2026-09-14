import { NextResponse } from "next/server";
import {
  ACCESS_ADMIN_ROLES,
  hasMembershipRole,
} from "@/lib/auth/membership-roles";
import { createClient } from "@/lib/supabase/server";
import { getCurrentContext } from "@/lib/tenant/current-context";
import {
  publicMessageForAccessRpcError,
  statusForAccessRpcError,
} from "@/lib/access/rpc-error";
import {
  containsTokenMaterial,
  mapAccessInvitation,
  mapAccessMembership,
  unwrapRpcPayload,
} from "@/lib/access/types";
import { loadTeamMembersForAccess } from "@/lib/team/access-users";

export async function GET() {
  const context = await getCurrentContext();

  if (!context) {
    return NextResponse.json(
      { error: "Unauthorized or tenant access denied" },
      { status: 403 }
    );
  }

  if (!hasMembershipRole(context.membership.role, ACCESS_ADMIN_ROLES)) {
    return NextResponse.json(
      { error: "Unauthorized or tenant access denied" },
      { status: 403 }
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_tenant_access", {
    p_tenant_id: context.tenant.id,
  });

  if (error || !data) {
    console.error("[GET /api/team/access] list_tenant_access failed", {
      tenantId: context.tenant.id,
      userId: context.user.id,
      code: error?.code,
      message: error?.message,
      details: error?.details,
      hint: error?.hint,
    });

    return NextResponse.json(
      {
        error: publicMessageForAccessRpcError(
          error?.code,
          error?.message,
          "Could not load access"
        ),
      },
      { status: statusForAccessRpcError(error?.code, error?.message) }
    );
  }

  const record = unwrapRpcPayload(data);
  const teamMembers = await loadTeamMembersForAccess(
    supabase,
    context.tenant.id
  );
  if (!teamMembers) {
    return NextResponse.json(
      { error: "Could not load access" },
      { status: 500 }
    );
  }
  const teamMemberByUser = new Map(
    teamMembers
      .filter((member) => member.user_id)
      .map((member) => [member.user_id as string, member] as const)
  );
  const memberships = (Array.isArray(record.memberships) ? record.memberships : [])
    .map((row) => mapAccessMembership(row))
    .filter((row): row is NonNullable<typeof row> => row !== null)
    .map((membership) => {
      const linked = teamMemberByUser.get(membership.user_id);
      return {
        ...membership,
        team_member: linked
          ? { id: linked.id, name: linked.name }
          : membership.team_member,
      };
    });
  const invitations = (Array.isArray(record.invitations) ? record.invitations : [])
    .map((row) => mapAccessInvitation(row))
    .filter((row): row is NonNullable<typeof row> => row !== null);

  const response = {
    tenant: {
      id: context.tenant.id,
      name: context.tenant.name,
      slug: context.tenant.slug,
    },
    memberships,
    invitations,
    team_members: teamMembers,
  };

  if (containsTokenMaterial(response)) {
    console.error("[GET /api/team/access] token material leaked in payload", {
      tenantId: context.tenant.id,
    });

    return NextResponse.json(
      { error: "Could not load access" },
      { status: 500 }
    );
  }

  return NextResponse.json(response);
}
