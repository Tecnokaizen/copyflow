import { NextRequest, NextResponse } from "next/server";
import {
  canManageQuickOrderLayout,
  mergeQuickOrderLayoutPreference,
  parseQuickOrderLayoutPatch,
  resolveQuickOrderLayout,
} from "@/lib/settings/quick-order-layout";
import { createClient } from "@/lib/supabase/server";
import { getCurrentContext } from "@/lib/tenant/current-context";

const ACCESS_DENIED = "Unauthorized or tenant access denied";

export async function GET() {
  const context = await getCurrentContext();

  if (
    !context ||
    !canManageQuickOrderLayout(context.membership.role)
  ) {
    return NextResponse.json({ error: ACCESS_DENIED }, { status: 403 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tenant_settings")
    .select("preferences, updated_at")
    .eq("tenant_id", context.tenant.id)
    .maybeSingle();

  if (error) {
    console.error(
      "[GET /api/settings/quick-order-layout] Could not load settings",
      {
        tenantId: context.tenant.id,
        error,
      }
    );
    return NextResponse.json(
      { error: "Could not load quick order settings" },
      { status: 500 }
    );
  }

  if (!data) {
    return NextResponse.json(
      { error: "Tenant settings not found" },
      { status: 404 }
    );
  }

  return NextResponse.json({
    layout: resolveQuickOrderLayout(data.preferences),
    revision: data.updated_at,
  });
}

export async function PATCH(request: NextRequest) {
  const context = await getCurrentContext();

  if (
    !context ||
    !canManageQuickOrderLayout(context.membership.role)
  ) {
    return NextResponse.json({ error: ACCESS_DENIED }, { status: 403 });
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

  const parsed = parseQuickOrderLayoutPatch(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: "Invalid value" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: current, error: loadError } = await supabase
    .from("tenant_settings")
    .select("preferences, updated_at")
    .eq("tenant_id", context.tenant.id)
    .maybeSingle();

  if (loadError) {
    console.error(
      "[PATCH /api/settings/quick-order-layout] Could not load settings",
      {
        tenantId: context.tenant.id,
        error: loadError,
      }
    );
    return NextResponse.json(
      { error: "Could not update quick order settings" },
      { status: 500 }
    );
  }

  if (!current) {
    return NextResponse.json(
      { error: "Tenant settings not found" },
      { status: 404 }
    );
  }

  if (current.updated_at !== parsed.revision) {
    return NextResponse.json(
      { error: "Quick order settings changed" },
      { status: 409 }
    );
  }

  const preferences = mergeQuickOrderLayoutPreference(
    current.preferences,
    parsed.layout
  );
  const { data: updated, error: updateError } = await supabase
    .from("tenant_settings")
    .update({ preferences })
    .eq("tenant_id", context.tenant.id)
    .eq("updated_at", parsed.revision)
    .select("preferences, updated_at")
    .maybeSingle();

  if (updateError) {
    console.error(
      "[PATCH /api/settings/quick-order-layout] Could not update settings",
      {
        tenantId: context.tenant.id,
        error: updateError,
      }
    );
    return NextResponse.json(
      { error: "Could not update quick order settings" },
      { status: 500 }
    );
  }

  if (!updated) {
    return NextResponse.json(
      { error: "Quick order settings changed" },
      { status: 409 }
    );
  }

  return NextResponse.json({
    ok: true,
    layout: resolveQuickOrderLayout(updated.preferences),
    revision: updated.updated_at,
  });
}
