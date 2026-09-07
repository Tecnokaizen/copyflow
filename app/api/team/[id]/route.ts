import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentContext } from "@/lib/tenant/current-context";
import { isUuid, parseTeamMemberPayload } from "@/lib/team/payload";
import {
  canWriteTeam,
  mapTeamMember,
  unwrapRpcPayload,
} from "@/lib/team/types";
import { statusForTeamRpcError } from "@/lib/team/rpc-error";

function extractMember(data: unknown) {
  const record = unwrapRpcPayload(data);
  if (record.member) {
    return mapTeamMember(record.member);
  }

  return mapTeamMember(record);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const context = await getCurrentContext();

  if (!context) {
    return NextResponse.json(
      { error: "Unauthorized or tenant access denied" },
      { status: 403 }
    );
  }

  if (!canWriteTeam(context.membership.role)) {
    return NextResponse.json(
      { error: "Unauthorized or tenant access denied" },
      { status: 403 }
    );
  }

  const { id } = await params;

  if (!isUuid(id)) {
    return NextResponse.json(
      { error: "Invalid team member" },
      { status: 400 }
    );
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const parsed = parseTeamMemberPayload(body as Record<string, unknown>);

  if (!parsed.ok) {
    return NextResponse.json(
      { error: "Invalid value" },
      { status: 400 }
    );
  }

  const supabase = await createClient();

  const { data, error } = await supabase.rpc("update_team_member", {
    p_team_member_id: id,
    p_name: parsed.data.name,
    p_job_title: parsed.data.job_title,
    p_department: parsed.data.department,
    p_active: parsed.data.active,
    p_can_receive_orders: parsed.data.can_receive_orders,
    p_tenant_id: context.tenant.id,
  });

  if (error || !data) {
    console.error("update_team_member", error?.message ?? "unknown error");

    return NextResponse.json(
      { error: "Could not update team member" },
      { status: statusForTeamRpcError(error?.code) }
    );
  }

  return NextResponse.json({
    ok: true,
    tenant: context.tenant.slug,
    member: extractMember(data),
  });
}
