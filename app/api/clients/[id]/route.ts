import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentContext } from "@/lib/tenant/current-context";
import { parseClientPayload } from "@/lib/clients/payload";
import { mapClientSummary } from "@/lib/clients/types";
import {
  clientDuplicateResponse,
  statusForClientRpcError,
} from "@/lib/clients/rpc-error";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return Array.isArray(value)
      ? asRecord(value[0])
      : null;
  }

  return value as Record<string, unknown>;
}

function mapOrderStatus(value: unknown) {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const id = typeof record.id === "string" ? record.id : null;
  const name = typeof record.name === "string" ? record.name : null;
  const code = typeof record.code === "string" ? record.code : null;

  if (!id || !name || !code) {
    return null;
  }

  return { id, name, code };
}

export async function GET(
  _request: NextRequest,
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
  const supabase = await createClient();
  const tenantId = context.tenant.id;

  const { data: clientRow, error: clientError } = await supabase
    .from("clients")
    .select(
      "id, customer_type_id, name, contact_name, company_name, tax_id, email, phone, notes, active, created_at, customer_type:customer_types(id, name)"
    )
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .maybeSingle();

  if (clientError) {
    console.error("load_client", clientError.message);
    return NextResponse.json(
      { error: "Could not load client" },
      { status: 500 }
    );
  }

  if (!clientRow) {
    return NextResponse.json(
      { error: "Client not found" },
      { status: 404 }
    );
  }

  const summary = mapClientSummary(clientRow);

  if (!summary) {
    return NextResponse.json(
      { error: "Client not found" },
      { status: 404 }
    );
  }

  const [{ count, error: countError }, { data: ordersRows, error: ordersError }] =
    await Promise.all([
      supabase
        .from("orders")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .eq("client_id", id),
      supabase
        .from("orders")
        .select(
          "id, reference, title, priority, due_at, created_at, status:order_statuses(id, name, code)"
        )
        .eq("tenant_id", tenantId)
        .eq("client_id", id)
        .order("created_at", { ascending: false })
        .limit(50),
    ]);

  if (countError || ordersError) {
    console.error(
      "load_client_orders",
      countError?.message ?? ordersError?.message ?? "unknown error"
    );
    return NextResponse.json(
      { error: "Could not load client" },
      { status: 500 }
    );
  }

  const orders = (ordersRows ?? []).map((row) => ({
    id: row.id,
    reference: row.reference,
    title: row.title,
    priority: row.priority,
    due_at: row.due_at,
    created_at: row.created_at,
    status: mapOrderStatus(row.status),
  }));

  const clientRecord = clientRow as Record<string, unknown>;

  return NextResponse.json({
    tenant: context.tenant.slug,
    client: {
      ...summary,
      active: clientRecord.active === false ? false : true,
      created_at:
        typeof clientRecord.created_at === "string"
          ? clientRecord.created_at
          : null,
    },
    orders_count: count ?? 0,
    last_order_at: orders[0]?.created_at ?? null,
    orders,
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

  const parsed = parseClientPayload(body as Record<string, unknown>);

  if (!parsed.ok) {
    return NextResponse.json(
      { error: "Invalid value" },
      { status: 400 }
    );
  }

  const supabase = await createClient();

  const { data, error } = await supabase.rpc("update_client", {
    p_client_id: id,
    p_customer_type_id: parsed.data.customer_type_id,
    p_name: parsed.data.name,
    p_contact_name: parsed.data.contact_name,
    p_company_name: parsed.data.company_name,
    p_tax_id: parsed.data.tax_id,
    p_email: parsed.data.email,
    p_phone: parsed.data.phone,
    p_notes: parsed.data.notes,
    p_tenant_id: context.tenant.id,
  });

  if (error || !data) {
    const duplicate = clientDuplicateResponse(error);
    if (duplicate) {
      return duplicate;
    }

    console.error("[PATCH /api/clients/:id] update_client failed", {
      tenantId: context.tenant.id,
      userId: context.user.id,
      clientId: id,
      code: error?.code,
      message: error?.message,
      details: error?.details,
      hint: error?.hint,
    });

    return NextResponse.json(
      { error: "Could not update client" },
      { status: statusForClientRpcError(error?.code) }
    );
  }

  return NextResponse.json({
    ok: true,
    tenant: context.tenant.slug,
    client: data.client,
  });
}
