import { NextRequest } from "next/server";
import { operationalJson } from "@/lib/http/operational-cache";
import { requireQuotesAccess } from "@/lib/quotes/guard";
import { QUOTE_MESSAGES } from "@/lib/quotes/errors";
import { isUuid } from "@/lib/team/payload";

type RouteContext = {
  params: Promise<{ id: string }>;
};

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
  const access = await requireQuotesAccess();
  if (!access.ok) {
    return access.response;
  }

  const { id } = await context.params;
  if (!isUuid(id)) {
    return operationalJson({ error: QUOTE_MESSAGES.notFound }, { status: 404 });
  }

  const { data: quote, error: quoteError } = await access.supabase
    .from("quotes")
    .select("id")
    .eq("id", id)
    .eq("tenant_id", access.context.tenant.id)
    .maybeSingle();

  if (quoteError || !quote) {
    return operationalJson({ error: QUOTE_MESSAGES.notFound }, { status: 404 });
  }

  const { data, error } = await access.supabase
    .from("activity_log")
    .select(
      "id, created_at, action, entity_type, entity_id, user_id, team_member_id, previous_values, new_values, metadata"
    )
    .eq("tenant_id", access.context.tenant.id)
    .eq("entity_type", "quote")
    .eq("entity_id", id)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    return operationalJson(
      { error: "No se pudo cargar la actividad" },
      { status: 500 }
    );
  }

  const rows = (data ?? []) as ActivityRow[];
  const userIds = [
    ...new Set(
      rows
        .map((row) => row.user_id)
        .filter((userId): userId is string => Boolean(userId))
    ),
  ];
  const nameByUserId = new Map<string, string>();

  if (userIds.length > 0) {
    const { data: profiles } = await access.supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", userIds);

    for (const profile of profiles ?? []) {
      const fullName =
        typeof profile.full_name === "string" ? profile.full_name.trim() : "";
      if (profile.id && fullName) {
        nameByUserId.set(profile.id, fullName);
      }
    }
  }

  return operationalJson({
    tenant: access.context.tenant.slug,
    events: rows.map((row) => {
      const metadata =
        row.metadata && typeof row.metadata === "object"
          ? (row.metadata as Record<string, unknown>)
          : null;
      const reference =
        typeof metadata?.reference === "string" ? metadata.reference : null;

      return {
        ...row,
        actor_type: row.user_id ? "user" : "system",
        actor_name: row.user_id
          ? (nameByUserId.get(row.user_id) ?? "Usuario")
          : "Sistema",
        entity_label: reference,
        changed_field:
          typeof metadata?.field === "string" ? metadata.field : null,
      };
    }),
  });
}
