import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { tenantOrigin } from "@/lib/tenant/domains";
import { parseInvitationAcceptPayload } from "@/lib/access/payload";
import { mapAcceptInvitationResult } from "@/lib/access/types";
import { invitationAcceptRpcFailure } from "@/lib/invitations/accept-error";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { error: "Inicia sesión para aceptar la invitación." },
      { status: 401 }
    );
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid value" }, { status: 400 });
  }

  const parsed = parseInvitationAcceptPayload(body);

  if (!parsed.ok) {
    return NextResponse.json({ error: "Invalid value" }, { status: 400 });
  }

  const { data, error } = await supabase.rpc("accept_tenant_invitation", {
    p_token: parsed.token,
  });

  if (error || !data) {
    console.error(
      "[POST /api/invitations/accept] accept_tenant_invitation failed",
      {
        userId: user.id,
        code: error?.code,
        message: error?.message,
        details: error?.details,
        hint: error?.hint,
      }
    );

    const failure = invitationAcceptRpcFailure(error);

    return NextResponse.json(
      {
        error: failure.error,
        ...(failure.code ? { code: failure.code } : {}),
      },
      { status: failure.status }
    );
  }

  const mapped = mapAcceptInvitationResult(data);

  if (!mapped) {
    console.error("[POST /api/invitations/accept] invalid RPC payload", {
      userId: user.id,
    });

    return NextResponse.json(
      { error: "Could not accept invitation" },
      { status: 500 }
    );
  }

  return NextResponse.json({
    tenant: mapped.tenant,
    membership: mapped.membership,
    team_member_id: mapped.team_member_id ?? null,
    tenant_origin: tenantOrigin(mapped.tenant.slug),
  });
}
