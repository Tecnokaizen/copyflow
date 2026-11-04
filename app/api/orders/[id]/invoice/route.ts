import { NextRequest, NextResponse } from "next/server";
import {
  invalidExpectedVersionResponse,
  parseExpectedVersion,
  readReturnedVersion,
  rpcExpectedVersionArg,
} from "@/lib/orders/concurrency";
import { parseInvoicePayload } from "@/lib/orders/invoice";
import { mapLifecycleRpcError } from "@/lib/orders/lifecycle-rpc-error";
import { createClient } from "@/lib/supabase/server";
import { getCurrentContext } from "@/lib/tenant/current-context";

/**
 * «Requiere factura» / «Factura entregada». Only records the two states
 * through change_order_invoice_v1; it issues no invoice. The tenant always
 * comes from the session, never from the request.
 */
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
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    body = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const invalidVersion = invalidExpectedVersionResponse(body.expected_version);
  if (invalidVersion) {
    return NextResponse.json(invalidVersion.body, { status: invalidVersion.status });
  }
  const expectedVersion = parseExpectedVersion(body.expected_version);
  if (!expectedVersion) {
    return NextResponse.json(
      { error: "expected_version is required" },
      { status: 422 }
    );
  }

  const invoice = parseInvoicePayload(body);
  if (!invoice.ok) {
    return NextResponse.json({ error: invoice.error }, { status: 400 });
  }

  const supabase = await createClient();

  const { data, error } = await supabase.rpc("change_order_invoice_v1", {
    p_order_id: id,
    p_invoice_required: invoice.value.invoice_required,
    p_invoice_delivered: invoice.value.invoice_delivered,
    p_tenant_id: context.tenant.id,
    p_expected_version: rpcExpectedVersionArg(expectedVersion),
  });

  if (error || !data) {
    console.error("[PATCH /api/orders/:id/invoice] change_order_invoice_v1 failed", {
      tenantId: context.tenant.id,
      userId: context.user.id,
      orderId: id,
      code: error?.code,
      message: error?.message,
      details: error?.details,
      hint: error?.hint,
    });

    const mapped = mapLifecycleRpcError(error, "Could not update invoice state");
    return NextResponse.json(mapped.body, { status: mapped.status });
  }

  const version = readReturnedVersion(data);
  if (!version) {
    return NextResponse.json(
      mapLifecycleRpcError(null, "Could not update invoice state").body,
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    tenant: context.tenant.slug,
    order: data.order,
    version,
  });
}
