import { NextRequest, NextResponse } from "next/server";

import { canManageSettingsCatalogs } from "@/lib/auth/membership-roles";
import {
  SETTINGS_CATALOGS,
  isSettingsCatalogKey,
  mapSettingsCatalogItem,
  parseSettingsCatalogPayload,
} from "@/lib/settings/catalogs";
import { createClient } from "@/lib/supabase/server";
import { getCurrentContext } from "@/lib/tenant/current-context";
import { isUuid } from "@/lib/team/payload";

function writeErrorStatus(code: string | undefined) {
  if (code === "23505") return 409;
  if (code === "42501") return 403;
  return 500;
}

export async function PATCH(
  request: NextRequest,
  {
    params,
  }: {
    params: Promise<{ catalog: string; id: string }>;
  }
) {
  const context = await getCurrentContext();

  if (!context || !canManageSettingsCatalogs(context.membership.role)) {
    return NextResponse.json(
      { error: "Unauthorized or tenant access denied" },
      { status: 403 }
    );
  }

  const { catalog, id } = await params;
  if (!isSettingsCatalogKey(catalog)) {
    return NextResponse.json({ error: "Catalog not found" }, { status: 404 });
  }
  if (!isUuid(id)) {
    return NextResponse.json({ error: "Invalid catalog item" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = parseSettingsCatalogPayload(body as Record<string, unknown>);
  if (!parsed.ok) {
    return NextResponse.json({ error: "Invalid value" }, { status: 400 });
  }

  const definition = SETTINGS_CATALOGS[catalog];
  const supabase = await createClient();

  const select = definition.hasCode
    ? "id, name, code, active, sort_order"
    : "id, name, active, sort_order";

  if (catalog === "entry_channels") {
    const { data: existing } = await supabase
      .from(definition.table)
      .select("id, code, active")
      .eq("tenant_id", context.tenant.id)
      .eq("id", id)
      .maybeSingle();

    if (!existing) {
      return NextResponse.json(
        { error: "Catalog item not found" },
        { status: 404 }
      );
    }

    if (
      existing.code === "kiosk" &&
      existing.active !== parsed.data.active
    ) {
      return NextResponse.json(
        {
          error:
            "El canal Kiosk se gestiona desde la configuración específica de Kiosk",
        },
        { status: 409 }
      );
    }
  }

  const { data, error } = await supabase
    .from(definition.table)
    .update({
      name: parsed.data.name,
      active: parsed.data.active,
      sort_order: parsed.data.sort_order,
    })
    .eq("tenant_id", context.tenant.id)
    .eq("id", id)
    .select(select)
    .maybeSingle();

  const item = mapSettingsCatalogItem(data);
  if (error) {
    console.error("[PATCH /api/settings/catalogs/:catalog/:id] update failed", {
      tenantId: context.tenant.id,
      catalog,
      itemId: id,
      code: error.code,
    });

    return NextResponse.json(
      {
        error:
          error.code === "23505"
            ? "Ya existe un elemento equivalente"
            : "Could not update catalog item",
      },
      { status: writeErrorStatus(error.code) }
    );
  }

  if (!item) {
    return NextResponse.json(
      { error: "Catalog item not found" },
      { status: 404 }
    );
  }

  return NextResponse.json({
    ok: true,
    tenant: context.tenant.slug,
    catalog,
    item,
  });
}
