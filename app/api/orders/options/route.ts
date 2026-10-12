import { NextResponse } from "next/server";
import { loadOrderOptions } from "@/lib/orders/options-load";
import { createClient } from "@/lib/supabase/server";
import { getCurrentContext } from "@/lib/tenant/current-context";

export async function GET() {
  const context = await getCurrentContext();

  if (!context) {
    return NextResponse.json(
      { error: "Unauthorized or tenant access denied" },
      { status: 403 }
    );
  }

  const supabase = await createClient();
  const loaded = await loadOrderOptions(supabase, {
    tenantId: context.tenant.id,
    tenantSlug: context.tenant.slug,
    userId: context.user.id,
    actorRole: context.membership.role,
  });

  if (!loaded.ok) {
    console.error("[GET /api/orders/options] Could not load order options", {
      tenantId: context.tenant.id,
      error: loaded.error,
    });

    return NextResponse.json(
      { error: "Could not load order options" },
      { status: 500 }
    );
  }

  const publicPayload = {
    tenant: loaded.data.tenant,
    services: loaded.data.services,
    file_statuses: loaded.data.file_statuses,
    max_file_bytes: loaded.data.max_file_bytes,
    entry_channels: loaded.data.entry_channels,
    order_contexts: loaded.data.order_contexts,
    team_members: loaded.data.team_members,
    stores: loaded.data.stores,
    actor_role: loaded.data.actor_role,
    current_team_member: loaded.data.current_team_member,
    quick_order_layout: loaded.data.quick_order_layout,
  };

  return NextResponse.json(publicPayload, {
    headers: {
      "Cache-Control": "private, no-store, max-age=0, must-revalidate",
    },
  });
}
