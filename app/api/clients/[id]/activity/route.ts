import { NextRequest } from "next/server";
import { operationalJson } from "@/lib/http/operational-cache";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/team/payload";
import { getCurrentContext } from "@/lib/tenant/current-context";

type RouteContext = { params: Promise<{ id: string }> };

type ActivityRow = {
  id: string;
  created_at: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  user_id: string | null;
  team_member_id: string | null;
  previous_values: unknown;
  new_values: unknown;
  metadata: unknown;
};

export async function GET(_request: NextRequest, context: RouteContext) {
  const current = await getCurrentContext();
  if (!current) {
    return operationalJson({ error: "Unauthorized or tenant access denied" }, { status: 403 });
  }
  const { id } = await context.params;
  if (!isUuid(id)) {
    return operationalJson({ error: "Cliente no encontrado" }, { status: 404 });
  }
  const supabase = await createClient();
  const { data: client, error: clientError } = await supabase
    .from("clients")
    .select("id")
    .eq("id", id)
    .eq("tenant_id", current.tenant.id)
    .maybeSingle();
  if (clientError || !client) {
    return operationalJson({ error: "Cliente no encontrado" }, { status: 404 });
  }
  const { data, error } = await supabase.rpc("list_client_activity", { p_client_id: id });
  if (error) {
    if (error.code === "P0002") {
      return operationalJson({ error: "Cliente no encontrado" }, { status: 404 });
    }
    return operationalJson({ error: "No se pudo cargar la actividad" }, { status: 500 });
  }
  const rows = (data ?? []) as ActivityRow[];
  const userIds = [...new Set(rows.map((row) => row.user_id).filter((userId): userId is string => Boolean(userId)))];
  const names = new Map<string, string>();
  if (userIds.length > 0) {
    const { data: profiles } = await supabase.from("profiles").select("id, full_name").in("id", userIds);
    for (const profile of profiles ?? []) {
      const name = typeof profile.full_name === "string" ? profile.full_name.trim() : "";
      if (profile.id && name) {
        names.set(profile.id, name);
      }
    }
  }
  return operationalJson({
    events: rows.map((row) => {
      const metadata = row.metadata && typeof row.metadata === "object" ? (row.metadata as Record<string, unknown>) : null;
      return {
        ...row,
        actor_type: row.user_id ? "user" : "system",
        actor_name: row.user_id ? (names.get(row.user_id) ?? "Usuario") : "Sistema",
        entity_label: typeof metadata?.client_name === "string" ? metadata.client_name : null,
        changed_field: typeof metadata?.field === "string" ? metadata.field : null,
      };
    }),
  });
}
