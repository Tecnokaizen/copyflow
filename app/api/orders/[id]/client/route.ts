import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentContext } from "@/lib/tenant/current-context";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ClientPayload = {
  customer_type_id: string | null;
  name: string;
  contact_name: string | null;
  company_name: string | null;
  tax_id: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
};

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

function normalizeOptionalText(
  value: unknown
): { ok: true; value: string | null } | { ok: false } {
  if (value == null) {
    return { ok: true, value: null };
  }

  if (typeof value !== "string") {
    return { ok: false };
  }

  const trimmed = value.trim();
  return { ok: true, value: trimmed ? trimmed : null };
}

function normalizeCustomerTypeId(
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

function parseClientPayload(
  payload: Record<string, unknown>
): { ok: true; data: ClientPayload } | { ok: false } {
  if (typeof payload.name !== "string") {
    return { ok: false };
  }

  const name = payload.name.trim();
  if (!name) {
    return { ok: false };
  }

  const customerTypeId = normalizeCustomerTypeId(payload.customer_type_id);
  const contactName = normalizeOptionalText(payload.contact_name);
  const companyName = normalizeOptionalText(payload.company_name);
  const taxId = normalizeOptionalText(payload.tax_id);
  const email = normalizeOptionalText(payload.email);
  const phone = normalizeOptionalText(payload.phone);
  const notes = normalizeOptionalText(payload.notes);

  if (
    !customerTypeId.ok ||
    !contactName.ok ||
    !companyName.ok ||
    !taxId.ok ||
    !email.ok ||
    !phone.ok ||
    !notes.ok
  ) {
    return { ok: false };
  }

  return {
    ok: true,
    data: {
      customer_type_id: customerTypeId.value,
      name,
      contact_name: contactName.value,
      company_name: companyName.value,
      tax_id: taxId.value,
      email: email.value,
      phone: phone.value,
      notes: notes.value,
    },
  };
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

  const parsed = parseClientPayload(body as Record<string, unknown>);

  if (!parsed.ok) {
    return NextResponse.json(
      { error: "Invalid value" },
      { status: 400 }
    );
  }

  const supabase = await createClient();

  const { data, error } = await supabase.rpc("create_client_and_assign_order", {
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
  });

  if (error || !data) {
    return NextResponse.json(
      {
        error: "Could not create client",
        detail: error?.message ?? null,
      },
      { status: statusForRpcError(error?.code) }
    );
  }

  return NextResponse.json({
    ok: true,
    tenant: context.tenant.slug,
    order: data.order,
    client: data.client,
  });
}
