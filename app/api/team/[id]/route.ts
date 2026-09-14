import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentContext } from "@/lib/tenant/current-context";
import { isUuid, parseTeamMemberPayload } from "@/lib/team/payload";
import { updateTeamMemberRpcParams } from "@/lib/team/atomic-update";
import {
  canWriteTeam,
  mapTeamMember,
  unwrapRpcPayload,
} from "@/lib/team/types";
import {
  classifyTeamMemberWriteError,
  statusForTeamRpcError,
} from "@/lib/team/rpc-error";

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

  const { data, error } = await supabase.rpc(
    "update_team_member",
    updateTeamMemberRpcParams({
      teamMemberId: id,
      tenantId: context.tenant.id,
      payload: parsed.data,
    })
  );

  if (error || !data) {
    console.error("update_team_member", error?.message ?? "unknown error");
    const mapped = classifyTeamMemberWriteError(error?.code, error?.message);

    if (mapped) {
      return NextResponse.json(
        { error: mapped.code, code: mapped.code },
        { status: mapped.status }
      );
    }

    return NextResponse.json(
      { error: "Could not update team member" },
      { status: statusForTeamRpcError(error?.code, error?.message) }
    );
  }

  return NextResponse.json({
    ok: true,
    tenant: context.tenant.slug,
    member: extractMember(data),
  });
}
