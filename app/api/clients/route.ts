import { NextRequest, NextResponse } from "next/server";
import {
  OPERATIVE_ROLES,
  hasMembershipRole,
} from "@/lib/auth/membership-roles";
import { createClient } from "@/lib/supabase/server";
import {
  requireCurrentAccess,
  roleDeniedResponse,
} from "@/lib/tenant/access-response";
import { parseClientPayload } from "@/lib/clients/payload";
import { CLIENT_ADDRESS_UNAVAILABLE, writeClient } from "@/lib/clients/write-rpc";
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
  const access = await requireCurrentAccess("GET /api/clients");

  if (!access.ok) {
    return access.response;
  }

  const context = access.context;

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
  const access = await requireCurrentAccess("POST /api/clients");

  if (!access.ok) {
    return access.response;
  }

  const context = access.context;

  if (!hasMembershipRole(context.membership.role, OPERATIVE_ROLES)) {
    return roleDeniedResponse("POST /api/clients", context.tenant.slug);
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

  const { data, error } = await writeClient(supabase, "create", {
    p_tenant_id: context.tenant.id,
    p_customer_type_id: parsed.data.customer_type_id,
    p_name: parsed.data.name,
    p_contact_name: parsed.data.contact_name,
    p_company_name: parsed.data.company_name,
    p_tax_id: parsed.data.tax_id,
    p_email: parsed.data.email,
    p_phone: parsed.data.phone,
    p_notes: parsed.data.notes,
  }, parsed.data.address);

  if (error || !data) {
    const duplicate = clientDuplicateResponse(error);
    if (duplicate) {
      return duplicate;
    }

    console.error("create_client", error?.message ?? "unknown error");

    return NextResponse.json(
      {
        error:
          error?.code === CLIENT_ADDRESS_UNAVAILABLE
            ? "La dirección todavía no está disponible. Guarda el cliente sin dirección o inténtalo más tarde."
            : "Could not create client",
      },
      { status: statusForClientRpcError(error?.code) }
    );
  }

  const created = data as { client?: unknown };
  return NextResponse.json({
    ok: true,
    tenant: context.tenant.slug,
    client: created.client ?? created,
  });
}
