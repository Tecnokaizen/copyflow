import { NextRequest, NextResponse } from "next/server";

import { canManageSettingsCatalogs } from "@/lib/auth/membership-roles";
import {
  orderStatusDomainError,
  orderStatusDomainErrorMessage,
  orderStatusWriteHttpStatus,
  parseOrderStatusPayload,
  unwrapOrderStatusRpc,
} from "@/lib/settings/order-statuses";
import { createClient } from "@/lib/supabase/server";
import { getCurrentContext } from "@/lib/tenant/current-context";
import { isUuid } from "@/lib/team/payload";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const context = await getCurrentContext();

  if (!context || !canManageSettingsCatalogs(context.membership.role)) {
    return NextResponse.json(
      { error: "Unauthorized or tenant access denied" },
      { status: 403 }
    );
  }

  const { id } = await params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
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
  if ("is_initial" in raw) {
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
  const { data, error } = await supabase.rpc("update_order_status_catalog", {
    p_tenant_id: context.tenant.id,
    p_status_id: id,
    p_name: parsed.data.name,
    p_kind: parsed.data.kind,
    p_active: parsed.data.active,
    p_sort_order: parsed.data.sort_order,
  });

  const status = unwrapOrderStatusRpc(data);
  if (error || !status) {
    const domain = orderStatusDomainError(error?.code, error?.message);
    console.error("[PATCH /api/order-statuses/:id] Could not update order status", {
      tenantId: context.tenant.id,
      statusId: id,
      code: error?.code,
      domain,
    });

    return NextResponse.json(
      {
        error: orderStatusDomainErrorMessage(
          domain,
          "Could not update order status"
        ),
      },
      { status: orderStatusWriteHttpStatus(domain, error?.code) }
    );
  }

  return NextResponse.json({
    ok: true,
    tenant: context.tenant.slug,
    status,
  });
}
