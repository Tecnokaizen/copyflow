import { NextResponse } from "next/server";
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
  const tenantId = context.tenant.id;

  const [
    clientsResult,
    servicesResult,
    entryChannelsResult,
    orderContextsResult,
    teamMembersResult,
  ] = await Promise.all([
    supabase
      .from("clients")
      .select("id, name")
      .eq("tenant_id", tenantId)
      .eq("active", true)
      .order("name", { ascending: true }),
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
  ]);

  const firstError =
    clientsResult.error ??
    servicesResult.error ??
    entryChannelsResult.error ??
    orderContextsResult.error ??
    teamMembersResult.error;

  if (firstError) {
    return NextResponse.json(
      {
        error: "Could not load order options",
        detail: firstError.message,
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    tenant: context.tenant.slug,
    clients: clientsResult.data ?? [],
    services: servicesResult.data ?? [],
    entry_channels: entryChannelsResult.data ?? [],
    order_contexts: orderContextsResult.data ?? [],
    team_members: teamMembersResult.data ?? [],
  });
}
