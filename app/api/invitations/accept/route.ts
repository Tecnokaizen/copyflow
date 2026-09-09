import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { tenantOrigin } from "@/lib/tenant/domains";
import { parseInvitationAcceptPayload } from "@/lib/access/payload";
import {
  publicMessageForAccessRpcError,
  statusForAccessRpcError,
} from "@/lib/access/rpc-error";
import { mapAcceptInvitationResult } from "@/lib/access/types";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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

    return NextResponse.json(
      {
        error: publicMessageForAccessRpcError(
          error?.code,
          error?.message,
          "Could not accept invitation"
        ),
      },
      { status: statusForAccessRpcError(error?.code, error?.message) }
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
    tenant_origin: tenantOrigin(mapped.tenant.slug),
  });
}
