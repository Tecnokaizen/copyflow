import { NextRequest, NextResponse } from "next/server";
import {
  canManageQuickOrderLayout,
  planQuickOrderLayoutUpdate,
  resolveQuickOrderLayout,
  serializeSettingsRevision,
  parseQuickOrderLayoutPatch,
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
        role: context.membership.role,
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
    revision: serializeSettingsRevision(data.updated_at),
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
        role: context.membership.role,
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

  const currentRevision = serializeSettingsRevision(current.updated_at);
  const planned = planQuickOrderLayoutUpdate({
    currentUpdatedAt: current.updated_at,
    submittedRevision: parsed.revision,
    currentPreferences: current.preferences,
    layout: parsed.layout,
    now: new Date(),
  });

  if (!planned.ok) {
    console.error(
      "[PATCH /api/settings/quick-order-layout] Revision mismatch",
      {
        tenantId: context.tenant.id,
        role: context.membership.role,
        revisionSent: parsed.revision,
        updatedAtCurrent: currentRevision,
        updateResult: "skipped",
      }
    );
    return NextResponse.json(
      { error: planned.error },
      { status: planned.status }
    );
  }

  const { data: updated, error: updateError } = await supabase
    .from("tenant_settings")
    .update(planned.values)
    .eq("tenant_id", context.tenant.id)
    .select("preferences, updated_at")
    .maybeSingle();

  if (updateError) {
    console.error(
      "[PATCH /api/settings/quick-order-layout] Could not update settings",
      {
        tenantId: context.tenant.id,
        role: context.membership.role,
        revisionSent: parsed.revision,
        updatedAtCurrent: currentRevision,
        updateResult: updateError,
        error: updateError,
      }
    );
    return NextResponse.json(
      { error: "Could not update quick order settings" },
      { status: 500 }
    );
  }

  if (!updated) {
    console.error(
      "[PATCH /api/settings/quick-order-layout] Update matched zero rows",
      {
        tenantId: context.tenant.id,
        role: context.membership.role,
        revisionSent: parsed.revision,
        updatedAtCurrent: currentRevision,
        updateResult: "zero-rows",
      }
    );
    return NextResponse.json(
      { error: "Could not update quick order settings" },
      { status: 500 }
    );
  }

  const { data: persistedRow, error: persistError } = await supabase
    .from("tenant_settings")
    .select("preferences, updated_at")
    .eq("tenant_id", context.tenant.id)
    .maybeSingle();

  if (persistError || !persistedRow) {
    console.error(
      "[PATCH /api/settings/quick-order-layout] Could not re-read settings",
      {
        tenantId: context.tenant.id,
        role: context.membership.role,
        revisionSent: parsed.revision,
        updatedAtCurrent: currentRevision,
        updateResult: persistError ?? "missing-row",
      }
    );
    return NextResponse.json(
      { error: "Could not update quick order settings" },
      { status: 500 }
    );
  }

  const persisted = resolveQuickOrderLayout(persistedRow.preferences);
  const persistedRevision = serializeSettingsRevision(
    persistedRow.updated_at
  );

  console.info("[PATCH /api/settings/quick-order-layout] Saved", {
    tenantId: context.tenant.id,
    role: context.membership.role,
    revisionSent: parsed.revision,
    updatedAtBefore: currentRevision,
    updatedAtAfter: persistedRevision,
    updateResult: "updated",
    preferences: persisted,
  });

  return NextResponse.json({
    ok: true,
    layout: persisted,
    revision: persistedRevision,
  });
}
