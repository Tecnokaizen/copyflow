import { NextRequest, NextResponse } from "next/server";
import {
  ACCESS_ADMIN_ROLES,
  hasMembershipRole,
} from "@/lib/auth/membership-roles";
import { createClient } from "@/lib/supabase/server";
import { getCurrentContext } from "@/lib/tenant/current-context";
import { invitationAcceptUrl } from "@/lib/tenant/app-origin";
import { sendTenantInvitationEmail } from "@/lib/email/send-tenant-invitation";
import { isUuid } from "@/lib/access/payload";
import {
  publicMessageForAccessRpcError,
  statusForAccessRpcError,
} from "@/lib/access/rpc-error";
import {
  mapCreateInvitationResult,
  toPublicCreatedInvitation,
} from "@/lib/access/types";

export async function POST(
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
  const { data, error } = await supabase.rpc("resend_tenant_invitation", {
    p_invitation_id: id,
  });

  if (error || !data) {
    console.error(
      "[POST /api/team/invitations/:id/resend] resend_tenant_invitation failed",
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
          "Could not resend invitation"
        ),
      },
      { status: statusForAccessRpcError(error?.code, error?.message) }
    );
  }

  const mapped = mapCreateInvitationResult(data);

  if (!mapped) {
    console.error(
      "[POST /api/team/invitations/:id/resend] invalid RPC payload",
      {
        tenantId: context.tenant.id,
        invitationId: id,
      }
    );

    return NextResponse.json(
      { error: "Could not resend invitation" },
      { status: 500 }
    );
  }

  const invitationUrl = invitationAcceptUrl(mapped.token);
  const publicBody = toPublicCreatedInvitation(mapped);

  const sendResult = await sendTenantInvitationEmail({
    email: mapped.invitation.email,
    tenantName: mapped.tenant.name,
    role: mapped.invitation.role,
    invitationUrl,
    expiresAt: mapped.invitation.expires_at ?? new Date().toISOString(),
  });

  if (!sendResult.ok) {
    console.error(
      "[POST /api/team/invitations/:id/resend] email delivery failed",
      {
        invitationId: mapped.invitation.id,
        tenantId: mapped.tenant.id,
        email: mapped.invitation.email,
        code: sendResult.code,
        message: sendResult.message,
      }
    );

    return NextResponse.json(
      {
        error: "Invitation email could not be sent",
        code: "email_delivery_failed",
        ...publicBody,
      },
      { status: 502 }
    );
  }

  console.info("[POST /api/team/invitations/:id/resend] invitation emailed", {
    invitationId: mapped.invitation.id,
    tenantId: mapped.tenant.id,
    email: mapped.invitation.email,
    providerMessageId: sendResult.providerMessageId,
  });

  return NextResponse.json(publicBody);
}
