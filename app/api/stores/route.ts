import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentContext } from "@/lib/tenant/current-context";
import { parseStoreCreatePayload } from "@/lib/stores/payload";
import { canWriteStores, mapStore } from "@/lib/stores/types";

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

function statusForStoreWriteError(code: string | undefined) {
  if (code === "23505") {
    return 409;
  }

  return 500;
}

export async function GET(request: NextRequest) {
  const context = await getCurrentContext();

  if (!context) {
    return NextResponse.json(
      { error: "Unauthorized or tenant access denied" },
      { status: 403 }
    );
  }

  const active = parseActive(request.nextUrl.searchParams.get("active"));
  const supabase = await createClient();

  let query = supabase
    .from("stores")
    .select("id, name, code, active")
    .eq("tenant_id", context.tenant.id)
    .order("name", { ascending: true });

  if (active !== null) {
    query = query.eq("active", active);
  }

  const { data, error } = await query;

  if (error) {
    console.error("[GET /api/stores] Could not load stores", {
      tenantId: context.tenant.id,
      error,
    });

    return NextResponse.json(
      { error: "Could not load stores" },
      { status: 500 }
    );
  }

  const stores = (data ?? [])
    .map((row) => mapStore(row))
    .filter((row): row is NonNullable<typeof row> => row !== null);

  return NextResponse.json({
    tenant: context.tenant.slug,
    stores,
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

  if (!canWriteStores(context.membership.role)) {
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

  const parsed = parseStoreCreatePayload(body as Record<string, unknown>);

  if (!parsed.ok) {
    return NextResponse.json(
      { error: "Invalid value" },
      { status: 400 }
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("stores")
    .insert({
      tenant_id: context.tenant.id,
      name: parsed.data.name,
      code: parsed.data.code,
      active: parsed.data.active,
    })
    .select("id, name, code, active")
    .single();

  if (error || !data) {
    console.error("[POST /api/stores] Could not create store", {
      tenantId: context.tenant.id,
      error,
    });

    return NextResponse.json(
      {
        error:
          error?.code === "23505"
            ? "A store with that name already exists"
            : "Could not create store",
      },
      { status: statusForStoreWriteError(error?.code) }
    );
  }

  return NextResponse.json(
    {
      ok: true,
      tenant: context.tenant.slug,
      store: mapStore(data),
    },
    { status: 201 }
  );
}
