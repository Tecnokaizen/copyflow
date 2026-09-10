import { NextRequest, NextResponse } from "next/server";
import {
  OPERATIVE_ROLES,
  hasMembershipRole,
} from "@/lib/auth/membership-roles";
import { createClient } from "@/lib/supabase/server";
import { getCurrentContext } from "@/lib/tenant/current-context";
import { parseClientPayload } from "@/lib/clients/payload";
import { mapClientSummaries } from "@/lib/clients/types";
import {
  clientDuplicateResponse,
  statusForClientRpcError,
} from "@/lib/clients/rpc-error";

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
    console.error("[GET /api/clients] search_clients failed", {
      tenantId: context.tenant.id,
      userId: context.user.id,
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
    });

    return NextResponse.json(
      { error: "Could not load clients" },
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

export async function POST(request: NextRequest) {
  const context = await getCurrentContext();

  if (!context) {
    return NextResponse.json(
      { error: "Unauthorized or tenant access denied" },
      { status: 403 }
    );
  }

  if (!hasMembershipRole(context.membership.role, OPERATIVE_ROLES)) {
    return NextResponse.json(
      { error: "Unauthorized or tenant access denied" },
      { status: 403 }
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

  const parsed = parseClientPayload(body as Record<string, unknown>);

  if (!parsed.ok) {
    return NextResponse.json(
      { error: "Invalid value" },
      { status: 400 }
    );
  }

  const supabase = await createClient();

  const { data, error } = await supabase.rpc("create_client", {
    p_tenant_id: context.tenant.id,
    p_customer_type_id: parsed.data.customer_type_id,
    p_name: parsed.data.name,
    p_contact_name: parsed.data.contact_name,
    p_company_name: parsed.data.company_name,
    p_tax_id: parsed.data.tax_id,
    p_email: parsed.data.email,
    p_phone: parsed.data.phone,
    p_notes: parsed.data.notes,
  });

  if (error || !data) {
    const duplicate = clientDuplicateResponse(error);
    if (duplicate) {
      return duplicate;
    }

    console.error("create_client", error?.message ?? "unknown error");

    return NextResponse.json(
      { error: "Could not create client" },
      { status: statusForClientRpcError(error?.code) }
    );
  }

  return NextResponse.json({
    ok: true,
    tenant: context.tenant.slug,
    client: data.client ?? data,
  });
}
