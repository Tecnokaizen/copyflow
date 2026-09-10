import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentContext } from "@/lib/tenant/current-context";

const DETAIL_FIELDS = [
  "priority",
  "service_id",
  "entry_channel_id",
  "assigned_team_member_id",
  "order_context_id",
  "due_at",
] as const;

const PRIORITIES = ["normal", "high", "urgent"] as const;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type DetailField = (typeof DETAIL_FIELDS)[number];

function statusForRpcError(code: string | undefined) {
  switch (code) {
    case "28000":
      return 401;
    case "42501":
      return 403;
    case "22023":
      return 400;
    case "P0002":
      return 404;
    default:
      return 500;
  }
}

function normalizeDetailValue(
  field: DetailField,
  rawValue: unknown
): { ok: true; value: string | null } | { ok: false } {
  if (field === "priority") {
    if (typeof rawValue !== "string") {
      return { ok: false };
    }

    const trimmed = rawValue.trim();
    if (
      !PRIORITIES.includes(trimmed as (typeof PRIORITIES)[number])
    ) {
      return { ok: false };
    }

    return { ok: true, value: trimmed };
  }

  if (field === "due_at") {
    if (rawValue == null) {
      return { ok: true, value: null };
    }

    if (typeof rawValue !== "string") {
      return { ok: false };
    }

    const trimmed = rawValue.trim();
    if (!trimmed) {
      return { ok: true, value: null };
    }

    const date = new Date(trimmed);
    if (Number.isNaN(date.getTime())) {
      return { ok: false };
    }

    return { ok: true, value: trimmed };
  }

  if (rawValue == null) {
    return { ok: true, value: null };
  }

  if (typeof rawValue !== "string") {
    return { ok: false };
  }

  const trimmed = rawValue.trim();
  if (!trimmed) {
    return { ok: true, value: null };
  }

  if (!UUID_PATTERN.test(trimmed)) {
    return { ok: false };
  }

  return { ok: true, value: trimmed };
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

  if (
    typeof field !== "string" ||
    !DETAIL_FIELDS.includes(field as DetailField)
  ) {
    return NextResponse.json(
      { error: "Invalid field" },
      { status: 400 }
    );
  }

  const normalized = normalizeDetailValue(
    field as DetailField,
    payload.value
  );

  if (!normalized.ok) {
    return NextResponse.json(
      { error: "Invalid value" },
      { status: 400 }
    );
  }

  const supabase = await createClient();

  const { data, error } = await supabase.rpc("change_order_details", {
    p_order_id: id,
    p_field: field,
    p_value: normalized.value,
    p_tenant_id: context.tenant.id,
  });

  if (error || !data) {
    console.error("[PATCH /api/orders/:id/details] change_order_details failed", {
      tenantId: context.tenant.id,
      userId: context.user.id,
      orderId: id,
      code: error?.code,
      message: error?.message,
      details: error?.details,
      hint: error?.hint,
    });

    return NextResponse.json(
      { error: "Could not update order details" },
      { status: statusForRpcError(error?.code) }
    );
  }

  return NextResponse.json({
    ok: true,
    tenant: context.tenant.slug,
    order: data.order,
    field: data.field,
    value: data.value,
  });
}
