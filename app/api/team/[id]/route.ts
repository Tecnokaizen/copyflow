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
import {
  linkDecisionStatus,
  resolveRequestedUserLink,
} from "@/lib/team/resolve-link";

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

  const { error: contactError } = await supabase
    .from("team_members")
    .update({
      email: parsed.data.email,
      phone: parsed.data.phone,
    })
    .eq("id", id)
    .eq("tenant_id", context.tenant.id);

  if (contactError) {
    console.error("update_team_member contact", contactError.message);
    return NextResponse.json(
      { error: "Could not update team member" },
      { status: 500 }
    );
  }

  if ("user_id" in (body as Record<string, unknown>)) {
    const decision = await resolveRequestedUserLink(supabase, {
      sessionTenantId: context.tenant.id,
      targetMemberId: id,
      userId: parsed.data.user_id,
    });

    if (!decision.ok) {
      return NextResponse.json(
        { error: decision.code, code: decision.code },
        { status: linkDecisionStatus(decision.code) }
      );
    }

    const { error: linkError } = await supabase
      .from("team_members")
      .update({ user_id: decision.userId })
      .eq("id", id)
      .eq("tenant_id", context.tenant.id);

    if (linkError) {
      const code = linkError.code ?? "";
      if (code === "23505") {
        return NextResponse.json(
          { error: "already_linked", code: "already_linked" },
          { status: 409 }
        );
      }
      console.error("update_team_member link", linkError.message);
      return NextResponse.json(
        { error: "Could not update team member" },
        { status: 500 }
      );
    }
  }

  const { data: updated } = await supabase
    .from("team_members")
    .select(
      "id, name, user_id, email, phone, job_title, department, active, can_receive_orders, notes, created_at, updated_at"
    )
    .eq("id", id)
    .eq("tenant_id", context.tenant.id)
    .maybeSingle();

  return NextResponse.json({
    ok: true,
    tenant: context.tenant.slug,
    member: mapTeamMember(updated) ?? extractMember(data),
  });
}
