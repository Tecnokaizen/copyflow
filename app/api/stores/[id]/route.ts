import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentContext } from "@/lib/tenant/current-context";
import { isUuid, parseStorePatchPayload } from "@/lib/stores/payload";
import { canWriteStores, mapStore } from "@/lib/stores/types";

function statusForStoreWriteError(code: string | undefined) {
  if (code === "23505") {
    return 409;
  }

  return 500;
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

  if (!canWriteStores(context.membership.role)) {
    return NextResponse.json(
      { error: "Unauthorized or tenant access denied" },
      { status: 403 }
    );
  }

  const { id } = await params;

  if (!isUuid(id)) {
    return NextResponse.json({ error: "Invalid store" }, { status: 400 });
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

  const parsed = parseStorePatchPayload(body as Record<string, unknown>);

  if (!parsed.ok) {
    return NextResponse.json(
      { error: "Invalid value" },
      { status: 400 }
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("stores")
    .update(parsed.data)
    .eq("id", id)
    .eq("tenant_id", context.tenant.id)
    .select("id, name, code, active")
    .maybeSingle();

  if (error) {
    console.error("[PATCH /api/stores/:id] Could not update store", {
      tenantId: context.tenant.id,
      storeId: id,
      error,
    });

    return NextResponse.json(
      {
        error:
          error.code === "23505"
            ? "A store with that name already exists"
            : "Could not update store",
      },
      { status: statusForStoreWriteError(error.code) }
    );
  }

  if (!data) {
    return NextResponse.json({ error: "Store not found" }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    tenant: context.tenant.slug,
    store: mapStore(data),
  });
}
