import { NextRequest, NextResponse } from "next/server";
import {
  ACCESS_ADMIN_ROLES,
  hasMembershipRole,
} from "@/lib/auth/membership-roles";
import { createClient } from "@/lib/supabase/server";
import { getCurrentContext } from "@/lib/tenant/current-context";
import { isUuid, parseAccessPatchPayload } from "@/lib/access/payload";
import {
  publicMessageForAccessRpcError,
  statusForAccessRpcError,
} from "@/lib/access/rpc-error";
import { unwrapRpcPayload } from "@/lib/access/types";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
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

  const { userId } = await params;

  if (!isUuid(userId)) {
    return NextResponse.json({ error: "Invalid value" }, { status: 400 });
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid value" }, { status: 400 });
  }

  const parsed = parseAccessPatchPayload(body);

  if (!parsed.ok) {
    return NextResponse.json({ error: "Invalid value" }, { status: 400 });
  }

  const supabase = await createClient();

  const rpc =
    parsed.action === "change_role"
      ? supabase.rpc("update_tenant_membership_role", {
          p_tenant_id: context.tenant.id,
          p_user_id: userId,
          p_role: parsed.role,
        })
      : supabase.rpc("set_tenant_membership_active", {
          p_tenant_id: context.tenant.id,
          p_user_id: userId,
          p_active: parsed.active,
        });

  const { data, error } = await rpc;

  if (error || !data) {
    console.error("[PATCH /api/team/access/:userId] membership update failed", {
      tenantId: context.tenant.id,
      userId: context.user.id,
      targetUserId: userId,
      action: parsed.action,
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
          "Could not update membership"
        ),
      },
      { status: statusForAccessRpcError(error?.code, error?.message) }
    );
  }

  const record = unwrapRpcPayload(data);
  const membershipRaw = record.membership;
  const membership =
    membershipRaw && typeof membershipRaw === "object"
      ? (membershipRaw as Record<string, unknown>)
      : record;

  return NextResponse.json({
    ok: true,
    membership: {
      user_id:
        typeof membership.user_id === "string" ? membership.user_id : userId,
      tenant_id:
        typeof membership.tenant_id === "string"
          ? membership.tenant_id
          : context.tenant.id,
      role: typeof membership.role === "string" ? membership.role : null,
      active:
        typeof membership.active === "boolean" ? membership.active : null,
      updated_at:
        typeof membership.updated_at === "string"
          ? membership.updated_at
          : null,
    },
  });
}
