import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentContext } from "@/lib/tenant/current-context";
import { isUuid, parseServicePayload } from "@/lib/services/payload";
import {
  canWriteServices,
  mapServiceItem,
  unwrapRpcPayload,
} from "@/lib/services/types";
import { statusForServiceRpcError } from "@/lib/services/rpc-error";

function extractService(data: unknown) {
  const record = unwrapRpcPayload(data);
  if (record.service) {
    return mapServiceItem(record.service);
  }

  return mapServiceItem(record);
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

  if (!canWriteServices(context.membership.role)) {
    return NextResponse.json(
      { error: "Unauthorized or tenant access denied" },
      { status: 403 }
    );
  }

  const { id } = await params;

  if (!isUuid(id)) {
    return NextResponse.json(
      { error: "Invalid service" },
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

  const parsed = parseServicePayload(body as Record<string, unknown>);

  if (!parsed.ok) {
    return NextResponse.json(
      { error: "Invalid value" },
      { status: 400 }
    );
  }

  const supabase = await createClient();

  const { data, error } = await supabase.rpc("update_service", {
    p_service_id: id,
    p_category_id: parsed.data.category_id,
    p_name: parsed.data.name,
    p_description: parsed.data.description,
    p_standard_lead_time_minutes: parsed.data.standard_lead_time_minutes,
    p_requires_file: parsed.data.requires_file,
    p_requires_design: parsed.data.requires_design,
    p_requires_quote: parsed.data.requires_quote,
    p_active: parsed.data.active,
    p_sort_order: parsed.data.sort_order,
    p_tenant_id: context.tenant.id,
  });

  if (error || !data) {
    console.error("update_service", error?.message ?? "unknown error");

    return NextResponse.json(
      { error: "Could not update service" },
      { status: statusForServiceRpcError(error?.code) }
    );
  }

  return NextResponse.json({
    ok: true,
    tenant: context.tenant.slug,
    service: extractService(data),
  });
}
