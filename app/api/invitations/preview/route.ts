import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { parseInvitationToken } from "@/lib/invitations/token";
import {
  mapInvitationPreview,
  toPublicInvitationPreview,
} from "@/lib/invitations/preview";

export async function POST(request: NextRequest) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "La invitación no es válida." }, { status: 400 });
  }

  const token =
    body && typeof body === "object" && "token" in body
      ? parseInvitationToken((body as { token?: unknown }).token)
      : null;

  if (!token) {
    return NextResponse.json({ error: "La invitación no es válida." }, { status: 400 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("preview_tenant_invitation", {
    p_token: token,
  });

  if (error || !data) {
    console.error("[POST /api/invitations/preview] preview_tenant_invitation failed", {
      code: error?.code,
      message: error?.message,
    });
    return NextResponse.json(
      { error: "No se pudo comprobar la invitación." },
      { status: 500 }
    );
  }

  const mapped = mapInvitationPreview(data);
  if (!mapped) {
    return NextResponse.json(
      { error: "No se pudo comprobar la invitación." },
      { status: 500 }
    );
  }

  return NextResponse.json(toPublicInvitationPreview(mapped), {
    headers: {
      "Cache-Control": "private, no-store, max-age=0, must-revalidate",
    },
  });
}
