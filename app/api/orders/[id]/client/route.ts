import { NextRequest, NextResponse } from "next/server";
import {
  invalidExpectedVersionResponse,
  parseExpectedVersion,
  readReturnedVersion,
  rpcExpectedVersionArg,
} from "@/lib/orders/concurrency";
import { archivedOrderConflict, mapLifecycleRpcError } from "@/lib/orders/lifecycle-rpc-error";
import { createClient } from "@/lib/supabase/server";
import { getCurrentContext } from "@/lib/tenant/current-context";
import { parseClientPayload, UUID_PATTERN } from "@/lib/clients/payload";
import { mapClientSummary } from "@/lib/clients/types";
import {
  clientDuplicateResponse,
  statusForClientRpcError,
} from "@/lib/clients/rpc-error";

function normalizeClientId(
  value: unknown
): { ok: true; value: string | null } | { ok: false } {
  if (value == null) {
    return { ok: true, value: null };
  }

  if (typeof value !== "string") {
    return { ok: false };
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return { ok: true, value: null };
  }

  if (!UUID_PATTERN.test(trimmed)) {
    return { ok: false };
  }

  return { ok: true, value: trimmed };
}

export async function POST(
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

  const parsed = parseClientPayload(payload);

  if (!parsed.ok) {
    return NextResponse.json(
      { error: "Invalid value" },
      { status: 400 }
    );
  }

  const supabase = await createClient();

  const { data, error } = await supabase.rpc("create_client_and_assign_order_v2", {
    p_order_id: id,
    p_customer_type_id: parsed.data.customer_type_id,
    p_name: parsed.data.name,
    p_contact_name: parsed.data.contact_name,
    p_company_name: parsed.data.company_name,
    p_tax_id: parsed.data.tax_id,
    p_email: parsed.data.email,
    p_phone: parsed.data.phone,
    p_notes: parsed.data.notes,
    p_tenant_id: context.tenant.id,
    p_expected_version: rpcExpectedVersionArg(expectedVersion),
  });

  if (error || !data) {
    const archived = archivedOrderConflict(error);
    if (archived) {
      return NextResponse.json(archived.body, { status: archived.status });
    }

    const mapped = mapLifecycleRpcError(error);
    if (mapped.body.code === "ORDER_STALE") {
      return NextResponse.json(mapped.body, { status: mapped.status });
    }

    const duplicate = clientDuplicateResponse(error);
    if (duplicate) {
      return duplicate;
    }

    console.error(
      "[POST /api/orders/:id/client] create_client_and_assign_order_v2 failed",
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

    return NextResponse.json(
      { error: "Could not create client" },
      { status: statusForClientRpcError(error?.code) }
    );
  }

  const version = readReturnedVersion(data);
  if (!version) {
    return NextResponse.json(
      { error: "Could not create client" },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    tenant: context.tenant.slug,
    order: data.order,
    client: data.client,
    version,
  });
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
  const clientId = normalizeClientId(payload.client_id);
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

  if (!clientId.ok) {
    return NextResponse.json(
      { error: "Invalid client_id" },
      { status: 400 }
    );
  }

  const supabase = await createClient();

  const { data, error } = await supabase.rpc("assign_order_client_v2", {
    p_order_id: id,
    p_client_id: clientId.value,
    p_tenant_id: context.tenant.id,
    p_expected_version: rpcExpectedVersionArg(expectedVersion),
  });

  if (error || !data) {
    const archived = archivedOrderConflict(error);
    if (archived) {
      return NextResponse.json(archived.body, { status: archived.status });
    }

    const mapped = mapLifecycleRpcError(error);
    if (mapped.body.code === "ORDER_STALE") {
      return NextResponse.json(mapped.body, { status: mapped.status });
    }

    console.error(
      "[PATCH /api/orders/:id/client] assign_order_client_v2 failed",
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

    return NextResponse.json(
      { error: "Could not assign client" },
      { status: statusForClientRpcError(error?.code) }
    );
  }

  const version = readReturnedVersion(data);
  if (!version) {
    return NextResponse.json(
      { error: "Could not assign client" },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    tenant: context.tenant.slug,
    order: data.order,
    client: mapClientSummary(data.client),
    version,
  });
}
