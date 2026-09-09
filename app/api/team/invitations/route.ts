import { NextRequest, NextResponse } from "next/server";
import {
  ACCESS_ADMIN_ROLES,
  hasMembershipRole,
} from "@/lib/auth/membership-roles";
import { createClient } from "@/lib/supabase/server";
import { getCurrentContext } from "@/lib/tenant/current-context";
import { parseInvitationCreatePayload } from "@/lib/access/payload";
import {
  publicMessageForAccessRpcError,
  statusForAccessRpcError,
} from "@/lib/access/rpc-error";
import { mapCreateInvitationResult } from "@/lib/access/types";

export async function POST(request: NextRequest) {
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

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid value" }, { status: 400 });
  }

  const parsed = parseInvitationCreatePayload(body);

  if (!parsed.ok) {
    return NextResponse.json({ error: "Invalid value" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_tenant_invitation", {
    p_tenant_id: context.tenant.id,
    p_email: parsed.email,
    p_role: parsed.role,
  });

  if (error || !data) {
    console.error("[POST /api/team/invitations] create_tenant_invitation failed", {
      tenantId: context.tenant.id,
      userId: context.user.id,
      role: parsed.role,
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
          "Could not create invitation"
        ),
      },
      { status: statusForAccessRpcError(error?.code, error?.message) }
    );
  }

  const mapped = mapCreateInvitationResult(data);

  if (!mapped) {
    console.error("[POST /api/team/invitations] invalid RPC payload", {
      tenantId: context.tenant.id,
      userId: context.user.id,
    });

    return NextResponse.json(
      { error: "Could not create invitation" },
      { status: 500 }
    );
  }

  // TODO(phase-2c-b / email transport):
  // When email delivery exists, keep the plaintext token server-side only,
  // send the invite link from the server, and stop returning `token` in this
  // public API response.
  return NextResponse.json(
    {
      invitation: mapped.invitation,
      token: mapped.token,
      tenant: mapped.tenant,
    },
    { status: 201 }
  );
}
