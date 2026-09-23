import { operationalJson } from "@/lib/http/operational-cache";
import { requireQuotesAccess } from "@/lib/quotes/guard";

export async function GET() {
  const access = await requireQuotesAccess();
  if (!access.ok) {
    return access.response;
  }

  const { data, error } = await access.supabase
    .from("quote_statuses")
    .select("id, name, code, color, sort_order")
    .eq("tenant_id", access.context.tenant.id)
    .eq("active", true)
    .order("sort_order", { ascending: true });

  if (error) {
    return operationalJson(
      { error: "No se pudieron cargar los estados" },
      { status: 500 }
    );
  }

  return operationalJson({
    tenant: access.context.tenant.slug,
    statuses: data ?? [],
  });
}
