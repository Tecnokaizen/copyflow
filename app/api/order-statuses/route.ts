import { NextRequest, NextResponse } from "next/server";

import { canManageSettingsCatalogs } from "@/lib/auth/membership-roles";
import {
  mapOrderStatus,
  nextAvailableStatusCode,
  orderStatusDomainError,
  orderStatusDomainErrorMessage,
  orderStatusWriteHttpStatus,
  parseOrderStatusPayload,
  unwrapOrderStatusRpc,
} from "@/lib/settings/order-statuses";
import { createClient } from "@/lib/supabase/server";
import { getCurrentContext } from "@/lib/tenant/current-context";

export async function GET() {
  const context = await getCurrentContext();

  if (!context) {
    return NextResponse.json(
      { error: "Unauthorized or tenant access denied" },
      { status: 403 }
    );
  }

  // Any tenant member can read statuses (needed by orders UI).
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("order_statuses")
    .select(
      "id, code, name, active, is_initial, is_ready, is_closed, is_cancelled, sort_order"
    )
    .eq("tenant_id", context.tenant.id)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  if (error) {
    console.error("[GET /api/order-statuses] Could not load order statuses", {
      tenantId: context.tenant.id,
      error,
    });

    return NextResponse.json(
      { error: "Could not load order statuses" },
      { status: 500 }
    );
  }

  const statuses = (data ?? [])
    .map((row) => mapOrderStatus(row))
    .filter((row): row is NonNullable<typeof row> => row !== null);

  return NextResponse.json({
    tenant: context.tenant.slug,
    count: statuses.length,
    statuses,
  });
}

export async function POST(request: NextRequest) {
  const context = await getCurrentContext();

  if (!context || !canManageSettingsCatalogs(context.membership.role)) {
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

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const raw = body as Record<string, unknown>;
  if ("is_initial" in raw && raw.is_initial === true) {
    return NextResponse.json(
      { error: "initial_status_must_use_set_initial" },
      { status: 400 }
    );
  }

  const parsed = parseOrderStatusPayload(raw);
  if (!parsed.ok) {
    return NextResponse.json({ error: "Invalid value" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: codeRows, error: codeError } = await supabase
    .from("order_statuses")
    .select("code")
    .eq("tenant_id", context.tenant.id);

  if (codeError) {
    return NextResponse.json(
      { error: "Could not create order status" },
      { status: 500 }
    );
  }

  const code = nextAvailableStatusCode(
    parsed.data.name,
    (codeRows ?? []).map((row) => String(row.code ?? ""))
  );

  if (!code) {
    return NextResponse.json(
      { error: "Could not generate a unique status code" },
      { status: 409 }
    );
  }

  const { data, error } = await supabase.rpc("create_order_status_catalog", {
    p_tenant_id: context.tenant.id,
    p_name: parsed.data.name,
    p_code: code,
    p_kind: parsed.data.kind,
    p_active: parsed.data.active,
    p_sort_order: parsed.data.sort_order,
  });

  const status = unwrapOrderStatusRpc(data);
  if (error || !status) {
    const domain = orderStatusDomainError(error?.code, error?.message);
    console.error("[POST /api/order-statuses] Could not create order status", {
      tenantId: context.tenant.id,
      code: error?.code,
      domain,
    });

    return NextResponse.json(
      {
        error: orderStatusDomainErrorMessage(
          domain,
          "Could not create order status"
        ),
      },
      { status: orderStatusWriteHttpStatus(domain, error?.code) }
    );
  }

  return NextResponse.json(
    {
      ok: true,
      tenant: context.tenant.slug,
      status,
    },
    { status: 201 }
  );
}
