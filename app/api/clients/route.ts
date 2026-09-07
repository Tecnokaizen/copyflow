import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentContext } from "@/lib/tenant/current-context";
import { mapClientSummaries } from "@/lib/clients/types";
import { statusForClientRpcError } from "@/lib/clients/rpc-error";

function parseLimit(raw: string | null) {
  if (!raw) {
    return 10;
  }

  const parsed = Number.parseInt(raw, 10);

  if (!Number.isFinite(parsed) || parsed < 1) {
    return 10;
  }

  return Math.min(parsed, 25);
}

export async function GET(request: NextRequest) {
  const context = await getCurrentContext();

  if (!context) {
    return NextResponse.json(
      { error: "Unauthorized or tenant access denied" },
      { status: 403 }
    );
  }

  const search = request.nextUrl.searchParams.get("search");
  const query = search?.trim() ? search.trim() : null;
  const limit = parseLimit(request.nextUrl.searchParams.get("limit"));

  const supabase = await createClient();

  const { data, error } = await supabase.rpc("search_clients", {
    p_tenant_id: context.tenant.id,
    p_query: query,
    p_limit: limit,
  });

  if (error) {
    return NextResponse.json(
      {
        error: "Could not load clients",
        detail: error.message,
      },
      { status: statusForClientRpcError(error.code) }
    );
  }

  const clients = mapClientSummaries(data);

  return NextResponse.json({
    tenant: context.tenant.slug,
    count: clients.length,
    clients,
  });
}
