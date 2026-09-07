import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentContext } from "@/lib/tenant/current-context";
import { UUID_PATTERN } from "@/lib/clients/payload";
import { mapClientListItem } from "@/lib/clients/types";
import { statusForClientRpcError } from "@/lib/clients/rpc-error";

function parsePage(raw: string | null) {
  if (!raw) {
    return 1;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return 1;
  }

  return parsed;
}

function parsePageSize(raw: string | null) {
  if (!raw) {
    return 25;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return 25;
  }

  return Math.min(parsed, 100);
}

function parseActive(raw: string | null) {
  if (!raw || raw === "all") {
    return null;
  }

  if (raw === "true") {
    return true;
  }

  if (raw === "false") {
    return false;
  }

  return null;
}

function parseCustomerTypeId(raw: string | null) {
  if (!raw || !raw.trim()) {
    return { ok: true as const, value: null };
  }

  const trimmed = raw.trim();
  if (!UUID_PATTERN.test(trimmed)) {
    return { ok: false as const };
  }

  return { ok: true as const, value: trimmed };
}

export async function GET(request: NextRequest) {
  const context = await getCurrentContext();

  if (!context) {
    return NextResponse.json(
      { error: "Unauthorized or tenant access denied" },
      { status: 403 }
    );
  }

  const params = request.nextUrl.searchParams;
  const search = params.get("search");
  const query = search?.trim() ? search.trim() : null;
  const customerTypeId = parseCustomerTypeId(params.get("customer_type_id"));

  if (!customerTypeId.ok) {
    return NextResponse.json(
      { error: "Invalid customer type" },
      { status: 400 }
    );
  }

  const supabase = await createClient();

  const { data, error } = await supabase.rpc("list_clients", {
    p_tenant_id: context.tenant.id,
    p_query: query,
    p_customer_type_id: customerTypeId.value,
    p_active: parseActive(params.get("active")),
    p_page: parsePage(params.get("page")),
    p_page_size: parsePageSize(params.get("page_size")),
  });

  if (error || !data) {
    console.error("list_clients", error?.message ?? "unknown error");

    return NextResponse.json(
      { error: "Could not load clients" },
      { status: statusForClientRpcError(error?.code) }
    );
  }

  const payload = Array.isArray(data) ? data[0] : data;
  const record =
    payload && typeof payload === "object"
      ? (payload as Record<string, unknown>)
      : {};

  const rawClients = Array.isArray(record.clients) ? record.clients : [];
  const clients = rawClients
    .map((row) => mapClientListItem(row))
    .filter((row): row is NonNullable<typeof row> => row !== null);

  return NextResponse.json({
    tenant: context.tenant.slug,
    clients,
    total: Number(record.total ?? clients.length) || 0,
    page: Number(record.page ?? 1) || 1,
    page_size: Number(record.page_size ?? 25) || 25,
    total_pages: Number(record.total_pages ?? 1) || 1,
    has_more: Boolean(record.has_more),
  });
}
