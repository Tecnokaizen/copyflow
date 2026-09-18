import { NextRequest, NextResponse } from "next/server";
import { mapLifecycleRpcError } from "@/lib/orders/lifecycle-rpc-error";
import { createClient } from "@/lib/supabase/server";
import { getCurrentContext } from "@/lib/tenant/current-context";

const CONTENT_FIELDS = ["title", "description", "notes"] as const;

type ContentField = (typeof CONTENT_FIELDS)[number];

function normalizeContentValue(
  field: ContentField,
  rawValue: unknown
): { ok: true; value: string | null } | { ok: false } {
  if (field === "title") {
    if (typeof rawValue !== "string") {
      return { ok: false };
    }

    const trimmed = rawValue.trim();
    if (!trimmed) {
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
    !CONTENT_FIELDS.includes(field as ContentField)
  ) {
    return NextResponse.json(
      { error: "Invalid field" },
      { status: 400 }
    );
  }

  const normalized = normalizeContentValue(
    field as ContentField,
    payload.value
  );

  if (!normalized.ok) {
    return NextResponse.json(
      { error: "Invalid value" },
      { status: 400 }
    );
  }

  const supabase = await createClient();

  const { data, error } = await supabase.rpc("change_order_content", {
    p_order_id: id,
    p_field: field,
    p_value: normalized.value,
    p_tenant_id: context.tenant.id,
  });

  if (error || !data) {
    console.error("[PATCH /api/orders/:id/content] change_order_content failed", {
      tenantId: context.tenant.id,
      userId: context.user.id,
      orderId: id,
      code: error?.code,
      message: error?.message,
      details: error?.details,
      hint: error?.hint,
    });

    const mapped = mapLifecycleRpcError(error, "Could not update order content");

    return NextResponse.json(mapped.body, { status: mapped.status });
  }

  return NextResponse.json({
    ok: true,
    tenant: context.tenant.slug,
    order: data.order,
    field: data.field,
    value: data.value,
  });
}
