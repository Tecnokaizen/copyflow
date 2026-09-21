import { NextRequest, NextResponse } from "next/server";

import { canManageSettingsCatalogs } from "@/lib/auth/membership-roles";
import {
  SETTINGS_CATALOGS,
  isSettingsCatalogKey,
  mapSettingsCatalogItem,
  nextAvailableCatalogCode,
  parseSettingsCatalogPayload,
  settingsCatalogDomainError,
  settingsCatalogDomainErrorMessage,
  settingsCatalogWriteHttpStatus,
} from "@/lib/settings/catalogs";
import { createClient } from "@/lib/supabase/server";
import { getCurrentContext } from "@/lib/tenant/current-context";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ catalog: string }> }
) {
  const context = await getCurrentContext();
  if (!context) {
    return NextResponse.json(
      { error: "Unauthorized or tenant access denied" },
      { status: 403 }
    );
  }

  const { catalog } = await params;
  if (!isSettingsCatalogKey(catalog)) {
    return NextResponse.json({ error: "Catalog not found" }, { status: 404 });
  }

  const definition = SETTINGS_CATALOGS[catalog];
  const supabase = await createClient();

  const select = definition.hasCode
    ? "id, name, code, active, sort_order"
    : "id, name, active, sort_order";

  const { data, error } = await supabase
    .from(definition.table)
    .select(select)
    .eq("tenant_id", context.tenant.id)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  if (error) {
    console.error("[GET /api/settings/catalogs/:catalog] load failed", {
      tenantId: context.tenant.id,
      catalog,
      code: error.code,
    });

    return NextResponse.json(
      { error: "Could not load catalog" },
      { status: 500 }
    );
  }

  const items = (data ?? [])
    .map((row) => mapSettingsCatalogItem(row))
    .filter((row): row is NonNullable<typeof row> => row !== null);

  return NextResponse.json({
    tenant: context.tenant.slug,
    catalog,
    items,
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ catalog: string }> }
) {
  const context = await getCurrentContext();

  if (!context || !canManageSettingsCatalogs(context.membership.role)) {
    return NextResponse.json(
      { error: "Unauthorized or tenant access denied" },
      { status: 403 }
    );
  }

  const { catalog } = await params;
  if (!isSettingsCatalogKey(catalog)) {
    return NextResponse.json({ error: "Catalog not found" }, { status: 404 });
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

  let code: string | null = null;
  if (definition.hasCode) {
    const { data: codeRows, error: codeError } = await supabase
      .from(definition.table)
      .select("code")
      .eq("tenant_id", context.tenant.id);

    if (codeError) {
      return NextResponse.json(
        { error: "Could not create catalog item" },
        { status: 500 }
      );
    }

    code = nextAvailableCatalogCode({
      catalog,
      name: parsed.data.name,
      existingCodes: (codeRows ?? []).map((row) => String(row.code ?? "")),
    });

    if (!code) {
      return NextResponse.json(
        { error: "Could not generate a unique internal code" },
        { status: 409 }
      );
    }
  }

  const insertPayload: Record<string, unknown> = {
    tenant_id: context.tenant.id,
    name: parsed.data.name,
    active: parsed.data.active,
    sort_order: parsed.data.sort_order,
  };
  if (definition.hasCode) {
    insertPayload.code = code;
  }

  const select = definition.hasCode
    ? "id, name, code, active, sort_order"
    : "id, name, active, sort_order";

  const { data, error } = await supabase
    .from(definition.table)
    .insert(insertPayload)
    .select(select)
    .single();

  const item = mapSettingsCatalogItem(data);
  if (error || !item) {
    const domain = settingsCatalogDomainError(error?.code, error?.message);
    console.error("[POST /api/settings/catalogs/:catalog] create failed", {
      tenantId: context.tenant.id,
      catalog,
      code: error?.code,
      domain,
    });

    return NextResponse.json(
      {
        error: settingsCatalogDomainErrorMessage(
          domain,
          "Could not create catalog item"
        ),
      },
      { status: settingsCatalogWriteHttpStatus(domain, error?.code) }
    );
  }

  return NextResponse.json(
    {
      ok: true,
      tenant: context.tenant.slug,
      catalog,
      item,
    },
    { status: 201 }
  );
}
