import { NextResponse } from "next/server";

import { canManageSettingsCatalogs } from "@/lib/auth/membership-roles";
import {
  orderStatusDomainError,
  orderStatusDomainErrorMessage,
  orderStatusWriteHttpStatus,
  unwrapOrderStatusRpc,
} from "@/lib/settings/order-statuses";
import { createClient } from "@/lib/supabase/server";
import { getCurrentContext } from "@/lib/tenant/current-context";
import { isUuid } from "@/lib/team/payload";

export async function POST(
  _request: Request,
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

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("set_order_status_initial", {
    p_tenant_id: context.tenant.id,
    p_status_id: id,
  });

  const status = unwrapOrderStatusRpc(data);
  if (error || !status) {
    const domain = orderStatusDomainError(error?.code, error?.message);
    console.error(
      "[POST /api/order-statuses/:id/set-initial] Could not set initial",
      {
        tenantId: context.tenant.id,
        statusId: id,
        code: error?.code,
        domain,
      }
    );

    return NextResponse.json(
      {
        error: orderStatusDomainErrorMessage(
          domain,
          "Could not set initial status"
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
