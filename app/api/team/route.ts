import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentContext } from "@/lib/tenant/current-context";
import { mapTeamMember, unwrapRpcPayload } from "@/lib/team/types";
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
  const members = rawMembers
    .map((row) => mapTeamMember(row))
    .filter((row): row is NonNullable<typeof row> => row !== null);

  return NextResponse.json({
    tenant: context.tenant.slug,
    members,
    total: Number(record.total ?? members.length) || 0,
    available_count: Number(record.available_count ?? 0) || 0,
    active_orders_count: Number(record.active_orders_count ?? 0) || 0,
  });
}
