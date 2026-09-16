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
const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0, must-revalidate",
} as const;

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: NO_STORE_HEADERS,
  });
}

export async function GET() {
  const context = await getCurrentContext();

  if (
    !context ||
    !canManageQuickOrderLayout(context.membership.role)
  ) {
    return json({ error: ACCESS_DENIED }, 403);
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
    return json({ error: "Could not load quick order settings" }, 500);
  }

  if (!data) {
    return json({ error: "Tenant settings not found" }, 404);
  }

  return json({
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
    return json({ error: ACCESS_DENIED }, 403);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const parsed = parseQuickOrderLayoutPatch(body);
  if (!parsed.ok) {
    return json({ error: "Invalid value" }, 400);
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
    return json({ error: "Could not update quick order settings" }, 500);
  }

  if (!current) {
    return json({ error: "Tenant settings not found" }, 404);
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
    return json({ error: planned.error }, planned.status);
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
    return json({ error: "Could not update quick order settings" }, 500);
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
    return json({ error: "Could not update quick order settings" }, 500);
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
    return json({ error: "Could not update quick order settings" }, 500);
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

  return json({
    ok: true,
    layout: persisted,
    revision: persistedRevision,
  });
}
