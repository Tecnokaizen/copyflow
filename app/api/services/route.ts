import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentContext } from "@/lib/tenant/current-context";
import { parseServicePayload, UUID_PATTERN } from "@/lib/services/payload";
import {
  canWriteServices,
  mapServiceItem,
  unwrapRpcPayload,
} from "@/lib/services/types";
import { statusForServiceRpcError } from "@/lib/services/rpc-error";

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

function parseCategoryId(raw: string | null) {
  if (!raw || !raw.trim()) {
    return { ok: true as const, value: null };
  }

  const trimmed = raw.trim();
  if (!UUID_PATTERN.test(trimmed)) {
    return { ok: false as const };
  }

  return { ok: true as const, value: trimmed };
}

function extractService(data: unknown) {
  const record = unwrapRpcPayload(data);
  if (record.service) {
    return mapServiceItem(record.service);
  }

  return mapServiceItem(record);
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
  const categoryId = parseCategoryId(params.get("category_id"));

  if (!categoryId.ok) {
    return NextResponse.json(
      { error: "Invalid category" },
      { status: 400 }
    );
  }

  const supabase = await createClient();

  const { data, error } = await supabase.rpc("list_services", {
    p_tenant_id: context.tenant.id,
    p_query: query,
    p_category_id: categoryId.value,
    p_active: parseActive(params.get("active")),
  });

  if (error || !data) {
    console.error("list_services", error?.message ?? "unknown error");

    return NextResponse.json(
      { error: "Could not load services" },
      { status: statusForServiceRpcError(error?.code) }
    );
  }

  const record = unwrapRpcPayload(data);
  const rawServices = Array.isArray(record.services) ? record.services : [];
  const services = rawServices
    .map((row) => mapServiceItem(row))
    .filter((row): row is NonNullable<typeof row> => row !== null);

  const average = record.average_standard_lead_time_minutes;
  const averageMinutes =
    typeof average === "number" && Number.isFinite(average)
      ? average
      : average == null
        ? null
        : Number(average);

  return NextResponse.json({
    tenant: context.tenant.slug,
    services,
    total: Number(record.total ?? services.length) || 0,
    average_standard_lead_time_minutes:
      averageMinutes != null && Number.isFinite(averageMinutes)
        ? averageMinutes
        : null,
  });
}

export async function POST(request: NextRequest) {
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

  const { data, error } = await supabase.rpc("create_service", {
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
    console.error("create_service", error?.message ?? "unknown error");

    return NextResponse.json(
      { error: "Could not create service" },
      { status: statusForServiceRpcError(error?.code) }
    );
  }

  return NextResponse.json({
    ok: true,
    tenant: context.tenant.slug,
    service: extractService(data),
  });
}
