import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentContext } from "@/lib/tenant/current-context";
import { canWriteTeam } from "@/lib/auth/membership-roles";
import {
  loadTeamMemberLinks,
  loadTenantAccessUsers,
} from "@/lib/team/access-users";
import { buildTeamMemberInsert } from "@/lib/team/insert";
import { parseTeamMemberPayload } from "@/lib/team/payload";
import {
  linkDecisionStatus,
  resolveRequestedUserLink,
} from "@/lib/team/resolve-link";
import {
  applyTeamMemberLinks,
  mapTeamMember,
  unwrapRpcPayload,
} from "@/lib/team/types";
import { statusForTeamRpcError } from "@/lib/team/rpc-error";

function parseActive(raw: string | null) {
  if (!raw || raw === "all") {
    return null;
  }

  if (raw === "true") {
    return true;
  }

  if (raw === "false") {
    return false;
  }

  return null;
}

export async function GET(request: NextRequest) {
  const context = await getCurrentContext();

  if (!context) {
    return NextResponse.json(
      { error: "Unauthorized or tenant access denied" },
      { status: 403 }
    );
  }

  const params = request.nextUrl.searchParams;
  const search = params.get("search");
  const query = search?.trim() ? search.trim() : null;

  const supabase = await createClient();

  const { data, error } = await supabase.rpc("list_team_members", {
    p_tenant_id: context.tenant.id,
    p_query: query,
    p_active: parseActive(params.get("active")),
  });

  if (error || !data) {
    console.error("list_team_members", error?.message ?? "unknown error");

    return NextResponse.json(
      { error: "Could not load team" },
      { status: statusForTeamRpcError(error?.code) }
    );
  }

  const record = unwrapRpcPayload(data);
  const rawMembers = Array.isArray(record.members) ? record.members : [];
  const mapped = rawMembers
    .map((row) => mapTeamMember(row))
    .filter((row): row is NonNullable<typeof row> => row !== null);

  const links = await loadTeamMemberLinks(supabase, context.tenant.id);
  if (!links) {
    return NextResponse.json(
      { error: "Could not load team" },
      { status: 500 }
    );
  }

  const members = applyTeamMemberLinks(mapped, links);
  const accessUsers = canWriteTeam(context.membership.role)
    ? await loadTenantAccessUsers(supabase, context.tenant.id, links)
    : [];

  if (accessUsers === null) {
    return NextResponse.json(
      { error: "Could not load team" },
      { status: 500 }
    );
  }

  return NextResponse.json({
    tenant: context.tenant.slug,
    members,
    total: Number(record.total ?? members.length) || 0,
    available_count: Number(record.available_count ?? 0) || 0,
    active_orders_count: Number(record.active_orders_count ?? 0) || 0,
    access_users: accessUsers,
  });
}

export async function POST(request: NextRequest) {
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

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = parseTeamMemberPayload(body as Record<string, unknown>);
  if (!parsed.ok) {
    return NextResponse.json({ error: "Invalid value" }, { status: 400 });
  }

  const supabase = await createClient();
  const decision = await resolveRequestedUserLink(supabase, {
    sessionTenantId: context.tenant.id,
    userId: parsed.data.user_id,
  });

  if (!decision.ok) {
    return NextResponse.json(
      { error: decision.code, code: decision.code },
      { status: linkDecisionStatus(decision.code) }
    );
  }

  const insert = buildTeamMemberInsert(context.tenant.id, {
    ...parsed.data,
    user_id: decision.userId,
  });

  const { data, error } = await supabase
    .from("team_members")
    .insert(insert)
    .select(
      "id, name, user_id, email, phone, job_title, department, active, can_receive_orders, notes, created_at, updated_at"
    )
    .maybeSingle();

  if (error || !data) {
    const code = error?.code ?? "";
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

    console.error("create team_member", error?.message ?? "unknown error");
    return NextResponse.json(
      { error: "Could not create team member" },
      { status: statusForTeamRpcError(error?.code) }
    );
  }

  return NextResponse.json(
    {
      ok: true,
      tenant: context.tenant.slug,
      member: mapTeamMember(data),
    },
    { status: 201 }
  );
}
