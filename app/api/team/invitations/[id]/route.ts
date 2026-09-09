import { NextRequest, NextResponse } from "next/server";
import {
  ACCESS_ADMIN_ROLES,
  hasMembershipRole,
} from "@/lib/auth/membership-roles";
import { createClient } from "@/lib/supabase/server";
import { getCurrentContext } from "@/lib/tenant/current-context";
import { isUuid } from "@/lib/access/payload";
import {
  publicMessageForAccessRpcError,
  statusForAccessRpcError,
} from "@/lib/access/rpc-error";
import { unwrapRpcPayload } from "@/lib/access/types";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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

  const { id } = await params;

  if (!isUuid(id)) {
    return NextResponse.json({ error: "Invalid value" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("revoke_tenant_invitation", {
    p_invitation_id: id,
  });

  if (error || !data) {
    console.error(
      "[DELETE /api/team/invitations/:id] revoke_tenant_invitation failed",
      {
        tenantId: context.tenant.id,
        userId: context.user.id,
        invitationId: id,
        code: error?.code,
        message: error?.message,
        details: error?.details,
        hint: error?.hint,
      }
    );

    return NextResponse.json(
      {
        error: publicMessageForAccessRpcError(
          error?.code,
          error?.message,
          "Could not revoke invitation"
        ),
      },
      { status: statusForAccessRpcError(error?.code, error?.message) }
    );
  }

  const record = unwrapRpcPayload(data);
  const invitationId =
    typeof record.invitation_id === "string" ? record.invitation_id : id;
  const status =
    typeof record.status === "string" ? record.status : "revoked";

  return NextResponse.json({
    ok: true,
    invitation: {
      id: invitationId,
      status,
      revoked_at:
        typeof record.revoked_at === "string" ? record.revoked_at : null,
    },
  });
}
