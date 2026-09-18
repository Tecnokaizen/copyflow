import { NextRequest, NextResponse } from "next/server";
import {
  invalidExpectedVersionResponse,
  parseExpectedVersion,
  readReturnedVersion,
  rpcExpectedVersionArg,
} from "@/lib/orders/concurrency";
import { mapLifecycleRpcError } from "@/lib/orders/lifecycle-rpc-error";
import { createClient } from "@/lib/supabase/server";
import { getCurrentContext } from "@/lib/tenant/current-context";

const MANAGEMENT_FIELDS = [
  "file_status_id",
  "quote_status_id",
  "payment_status_id",
  "delivery_method_id",
] as const;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ManagementField = (typeof MANAGEMENT_FIELDS)[number];

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

  const { id } = await params;

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

  const payload = body as Record<string, unknown>;
  const field = payload.field;
  const rawValueId = payload.value_id;
  const invalidVersion = invalidExpectedVersionResponse(payload.expected_version);
  if (invalidVersion) {
    return NextResponse.json(invalidVersion.body, { status: invalidVersion.status });
  }
  const expectedVersion = parseExpectedVersion(payload.expected_version);
  if (!expectedVersion) {
    return NextResponse.json(
      { error: "expected_version is required" },
      { status: 422 }
    );
  }

  if (
    typeof field !== "string" ||
    !MANAGEMENT_FIELDS.includes(field as ManagementField)
  ) {
    return NextResponse.json(
      { error: "Invalid field" },
      { status: 400 }
    );
  }

  let valueId: string | null;

  if (rawValueId == null) {
    valueId = null;
  } else if (typeof rawValueId !== "string") {
    return NextResponse.json(
      { error: "Invalid value_id" },
      { status: 400 }
    );
  } else {
    const trimmed = rawValueId.trim();
    if (!trimmed) {
      valueId = null;
    } else if (!UUID_PATTERN.test(trimmed)) {
      return NextResponse.json(
        { error: "Invalid value_id" },
        { status: 400 }
      );
    } else {
      valueId = trimmed;
    }
  }

  const supabase = await createClient();

  const { data, error } = await supabase.rpc("change_order_management_v2", {
    p_order_id: id,
    p_field: field,
    p_value_id: valueId,
    p_tenant_id: context.tenant.id,
    p_expected_version: rpcExpectedVersionArg(expectedVersion),
  });

  if (error || !data) {
    console.error(
      "[PATCH /api/orders/:id/management] change_order_management_v2 failed",
      {
        tenantId: context.tenant.id,
        userId: context.user.id,
        orderId: id,
        code: error?.code,
        message: error?.message,
        details: error?.details,
        hint: error?.hint,
      }
    );

    const mapped = mapLifecycleRpcError(error, "Could not update order management");

    return NextResponse.json(mapped.body, { status: mapped.status });
  }

  const version = readReturnedVersion(data);
  if (!version) {
    return NextResponse.json(
      mapLifecycleRpcError(null, "Could not update order management").body,
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    tenant: context.tenant.slug,
    order: data.order,
    field: data.field,
    value: data.value,
    version,
  });
}
