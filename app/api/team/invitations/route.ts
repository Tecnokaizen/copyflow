import { NextRequest, NextResponse } from "next/server";
import {
  ACCESS_ADMIN_ROLES,
  hasMembershipRole,
} from "@/lib/auth/membership-roles";
import { createClient } from "@/lib/supabase/server";
import { getCurrentContext } from "@/lib/tenant/current-context";
import { invitationAcceptUrl } from "@/lib/tenant/app-origin";
import { sendTenantInvitationEmail } from "@/lib/email/send-tenant-invitation";
import { parseInvitationCreatePayload } from "@/lib/access/payload";
import {
  publicMessageForAccessRpcError,
  statusForAccessRpcError,
} from "@/lib/access/rpc-error";
import {
  mapCreateInvitationResult,
  toPublicCreatedInvitation,
} from "@/lib/access/types";

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

  const invitationUrl = invitationAcceptUrl(mapped.tenant.slug, mapped.token);
  const publicBody = toPublicCreatedInvitation(mapped);

  const sendResult = await sendTenantInvitationEmail({
    email: mapped.invitation.email,
    tenantName: mapped.tenant.name,
    role: mapped.invitation.role,
    invitationUrl,
    expiresAt: mapped.invitation.expires_at ?? new Date().toISOString(),
  });

  if (!sendResult.ok) {
    console.error("[POST /api/team/invitations] email delivery failed", {
      invitationId: mapped.invitation.id,
      tenantId: mapped.tenant.id,
      email: mapped.invitation.email,
      code: sendResult.code,
      message: sendResult.message,
    });

    return NextResponse.json(
      {
        error: "Invitation created but email could not be sent",
        code: "email_delivery_failed",
        ...publicBody,
      },
      { status: 502 }
    );
  }

  console.info("[POST /api/team/invitations] invitation emailed", {
    invitationId: mapped.invitation.id,
    tenantId: mapped.tenant.id,
    email: mapped.invitation.email,
    providerMessageId: sendResult.providerMessageId,
  });

  return NextResponse.json(publicBody, { status: 201 });
}
