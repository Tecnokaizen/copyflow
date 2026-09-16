import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentContext } from "@/lib/tenant/current-context";
import { resolveCurrentTeamMember } from "@/lib/team/current-member";
import { resolveQuickOrderLayout } from "@/lib/settings/quick-order-layout";

export async function GET() {
  const context = await getCurrentContext();

  if (!context) {
    return NextResponse.json(
      { error: "Unauthorized or tenant access denied" },
      { status: 403 }
    );
  }

  const supabase = await createClient();
  const tenantId = context.tenant.id;
  const currentTeamMember = await resolveCurrentTeamMember(
    supabase,
    tenantId,
    context.user.id
  );

  const [
    servicesResult,
    entryChannelsResult,
    orderContextsResult,
    teamMembersResult,
    storesResult,
    settingsResult,
  ] = await Promise.all([
    supabase
      .from("services")
      .select("id, name")
      .eq("tenant_id", tenantId)
      .eq("active", true)
      .order("name", { ascending: true }),
    supabase
      .from("entry_channels")
      .select("id, code, name")
      .eq("tenant_id", tenantId)
      .eq("active", true)
      .order("sort_order", { ascending: true }),
    supabase
      .from("order_contexts")
      .select("id, code, name")
      .eq("tenant_id", tenantId)
      .eq("active", true)
      .order("sort_order", { ascending: true }),
    supabase
      .from("team_members")
      .select("id, name")
      .eq("tenant_id", tenantId)
      .eq("active", true)
      .order("name", { ascending: true }),
    supabase
      .from("stores")
      .select("id, name")
      .eq("tenant_id", tenantId)
      .eq("active", true)
      .order("name", { ascending: true }),
    supabase
      .from("tenant_settings")
      .select("preferences")
      .eq("tenant_id", tenantId)
      .maybeSingle(),
  ]);

  const firstError =
    servicesResult.error ??
    entryChannelsResult.error ??
    orderContextsResult.error ??
    teamMembersResult.error ??
    storesResult.error ??
    settingsResult.error;

  if (firstError) {
    console.error("[GET /api/orders/options] Could not load order options", {
      tenantId,
      error: firstError,
    });

    return NextResponse.json(
      { error: "Could not load order options" },
      { status: 500 }
    );
  }

  return NextResponse.json({
    tenant: context.tenant.slug,
    services: servicesResult.data ?? [],
    entry_channels: entryChannelsResult.data ?? [],
    order_contexts: orderContextsResult.data ?? [],
    team_members: teamMembersResult.data ?? [],
    stores: storesResult.data ?? [],
    actor_role: context.membership.role,
    current_team_member: currentTeamMember,
    quick_order_layout: resolveQuickOrderLayout(
      settingsResult.data?.preferences
    ),
  });
}
