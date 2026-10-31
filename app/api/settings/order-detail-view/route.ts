import { NextRequest, NextResponse } from "next/server";

import {
  canManageOrderDetailView,
  orderDetailViewState,
  parseOrderDetailViewPatch,
  planOrderDetailViewUpdate,
} from "@/lib/settings/order-detail-view";
import { createClient } from "@/lib/supabase/server";
import { getCurrentContext } from "@/lib/tenant/current-context";

// Order Detail Views V1: the tenant's view of the order page.
// GET and PATCH are owner/admin only; RLS (tenant_settings_update_owner_admin)
// enforces the same rule in the database. The UPDATE is conditional on the
// updated_at the client saw, so two admins never overwrite each other.

const ACCESS_DENIED = "Unauthorized or tenant access denied";
const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0, must-revalidate",
} as const;

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE_HEADERS });
}

export async function GET() {
  const context = await getCurrentContext();
  if (!context || !canManageOrderDetailView(context.membership.role)) {
    return json({ error: ACCESS_DENIED }, 403);
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tenant_settings")
    .select("preferences, updated_at")
    .eq("tenant_id", context.tenant.id)
    .maybeSingle();

  if (error) {
    console.error("[GET /api/settings/order-detail-view] Could not load settings", {
      tenantId: context.tenant.id,
      error,
    });
    return json({ error: "Could not load order detail view" }, 500);
  }
  if (!data) return json({ error: "Tenant settings not found" }, 404);

  return json(orderDetailViewState(data.preferences, data.updated_at));
}

export async function PATCH(request: NextRequest) {
  const context = await getCurrentContext();
  if (!context || !canManageOrderDetailView(context.membership.role)) {
    return json({ error: ACCESS_DENIED }, 403);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const parsed = parseOrderDetailViewPatch(body);
  if (!parsed.ok) return json({ error: "Invalid value" }, 400);

  const supabase = await createClient();
  const { data: current, error: loadError } = await supabase
    .from("tenant_settings")
    .select("preferences, updated_at")
    .eq("tenant_id", context.tenant.id)
    .maybeSingle();

  if (loadError) {
    console.error("[PATCH /api/settings/order-detail-view] Could not load settings", {
      tenantId: context.tenant.id,
      error: loadError,
    });
    return json({ error: "Could not update order detail view" }, 500);
  }
  if (!current) return json({ error: "Tenant settings not found" }, 404);

  const planned = planOrderDetailViewUpdate({
    currentUpdatedAt: current.updated_at,
    submittedRevision: parsed.revision,
    currentPreferences: current.preferences,
    view: parsed.view,
    userId: context.user.id,
    now: new Date(),
  });

  if (!planned.ok) {
    return json(
      {
        error: planned.error,
        current: orderDetailViewState(current.preferences, current.updated_at),
      },
      409
    );
  }

  // Compare-and-set: only the row the client saw. Zero rows means someone
  // saved in between (or RLS denied it): never overwrite blindly.
  const { data: updated, error: updateError } = await supabase
    .from("tenant_settings")
    .update({ preferences: planned.preferences })
    .eq("tenant_id", context.tenant.id)
    .eq("updated_at", current.updated_at)
    .select("preferences, updated_at")
    .maybeSingle();

  if (updateError) {
    console.error("[PATCH /api/settings/order-detail-view] Could not update settings", {
      tenantId: context.tenant.id,
      role: context.membership.role,
      error: updateError,
    });
    return json({ error: "Could not update order detail view" }, 500);
  }

  if (!updated) {
    const { data: latest } = await supabase
      .from("tenant_settings")
      .select("preferences, updated_at")
      .eq("tenant_id", context.tenant.id)
      .maybeSingle();
    return json(
      {
        error: "Order detail view changed",
        current: latest
          ? orderDetailViewState(latest.preferences, latest.updated_at)
          : null,
      },
      409
    );
  }

  const state = orderDetailViewState(updated.preferences, updated.updated_at);
  console.info("[PATCH /api/settings/order-detail-view] Saved", {
    tenantId: context.tenant.id,
    role: context.membership.role,
    view: state.view,
    previousView: state.previousView,
  });
  return json({ ok: true, ...state });
}
