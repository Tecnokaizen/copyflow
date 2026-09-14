import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentContext } from "@/lib/tenant/current-context";
import { canWriteTeam } from "@/lib/auth/membership-roles";
import { isUuid } from "@/lib/team/payload";
import { evaluateLinkChange, parseLinkBody } from "@/lib/team/link";
import { applyTeamMemberLinks, mapTeamMember } from "@/lib/team/types";

function postgresCode(error: { code?: string; message?: string } | null) {
  return error?.code ?? "";
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
    return NextResponse.json({ error: "Invalid team member" }, { status: 400 });
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = parseLinkBody(body);

  if (!parsed.ok) {
    return NextResponse.json({ error: "Invalid value" }, { status: 400 });
  }

  const supabase = await createClient();

  const { data: member, error: memberError } = await supabase
    .from("team_members")
    .select("id, name, user_id, email, phone, job_title, department, active, can_receive_orders, notes, created_at, updated_at")
    .eq("id", id)
    .eq("tenant_id", context.tenant.id)
    .maybeSingle();

  if (memberError || !member) {
    return NextResponse.json({ error: "Team member not found" }, { status: 404 });
  }

  let membership: { tenantId: string; userId: string } | null = null;
  let existingLinkMemberId: string | null = null;

  if (parsed.userId) {
    const { data: membershipRow } = await supabase
      .from("memberships")
      .select("tenant_id, user_id")
      .eq("tenant_id", context.tenant.id)
      .eq("user_id", parsed.userId)
      .maybeSingle();

    if (
      membershipRow &&
      typeof membershipRow.tenant_id === "string" &&
      typeof membershipRow.user_id === "string"
    ) {
      membership = {
        tenantId: membershipRow.tenant_id,
        userId: membershipRow.user_id,
      };
    }

    const { data: existing } = await supabase
      .from("team_members")
      .select("id")
      .eq("tenant_id", context.tenant.id)
      .eq("user_id", parsed.userId)
      .maybeSingle();

    existingLinkMemberId =
      existing && typeof existing.id === "string" ? existing.id : null;
  }

  const decision = evaluateLinkChange({
    targetMemberId: id,
    sessionTenantId: context.tenant.id,
    userId: parsed.userId,
    membership,
    existingLinkMemberId,
  });

  if (!decision.ok) {
    const status =
      decision.code === "already_linked"
        ? 409
        : decision.code === "membership_missing"
          ? 400
          : 403;

    return NextResponse.json({ error: decision.code, code: decision.code }, { status });
  }

  const { data: updated, error: updateError } = await supabase
    .from("team_members")
    .update({ user_id: decision.userId })
    .eq("id", id)
    .eq("tenant_id", context.tenant.id)
    .select(
      "id, name, user_id, email, phone, job_title, department, active, can_receive_orders, notes, created_at, updated_at"
    )
    .maybeSingle();

  if (updateError || !updated) {
    const code = postgresCode(updateError);
    if (code === "23505") {
      return NextResponse.json(
        { error: "already_linked", code: "already_linked" },
        { status: 409 }
      );
    }

    if (code === "23503") {
      return NextResponse.json(
        { error: "membership_missing", code: "membership_missing" },
        { status: 400 }
      );
    }

    console.error("team_members link update", updateError?.message ?? "unknown");
    return NextResponse.json(
      { error: "Could not update team member link" },
      { status: 500 }
    );
  }

  const mapped = mapTeamMember(updated);
  const memberResponse = mapped
    ? applyTeamMemberLinks([mapped], [
        {
          id: typeof updated.id === "string" ? updated.id : id,
          user_id:
            typeof updated.user_id === "string" ? updated.user_id : null,
        },
      ])[0]
    : null;

  return NextResponse.json({
    ok: true,
    tenant: context.tenant.slug,
    member: memberResponse,
  });
}
