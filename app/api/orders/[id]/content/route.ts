import { NextRequest, NextResponse } from "next/server";
import {
  invalidExpectedVersionResponse,
  parseExpectedVersion,
  readReturnedVersion,
  rpcExpectedVersionArg,
} from "@/lib/orders/concurrency";
import { normalizeExternalFolderUrl } from "@/lib/orders/external-folder-url";
import { mapLifecycleRpcError } from "@/lib/orders/lifecycle-rpc-error";
import { createClient } from "@/lib/supabase/server";
import { getCurrentContext } from "@/lib/tenant/current-context";

const CONTENT_FIELDS = [
  "title",
  "description",
  "notes",
  "external_folder_url",
] as const;

type ContentField = (typeof CONTENT_FIELDS)[number];

function normalizeContentValue(
  field: ContentField,
  rawValue: unknown
): { ok: true; value: string | null } | { ok: false } {
  if (field === "external_folder_url") {
    return normalizeExternalFolderUrl(rawValue);
  }

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

  const { data, error } = await supabase.rpc("change_order_content_v2", {
    p_order_id: id,
    p_field: field,
    p_value: normalized.value,
    p_tenant_id: context.tenant.id,
    p_expected_version: rpcExpectedVersionArg(expectedVersion),
  });

  if (error || !data) {
    console.error("[PATCH /api/orders/:id/content] change_order_content_v2 failed", {
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

  const version = readReturnedVersion(data);
  if (!version) {
    return NextResponse.json(
      mapLifecycleRpcError(null, "Could not update order content").body,
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
