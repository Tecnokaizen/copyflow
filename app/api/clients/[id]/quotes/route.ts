import { NextRequest } from "next/server";
import { operationalJson } from "@/lib/http/operational-cache";
import { QUOTE_MESSAGES } from "@/lib/quotes/errors";
import { requireQuotesAccess } from "@/lib/quotes/guard";
import { isUuid } from "@/lib/team/payload";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const access = await requireQuotesAccess();
  if (!access.ok) {
    return access.response;
  }
  const { id } = await context.params;
  if (!isUuid(id)) {
    return operationalJson({ error: QUOTE_MESSAGES.notFound }, { status: 404 });
  }
  const { data: client, error: clientError } = await access.supabase
    .from("clients")
    .select("id")
    .eq("id", id)
    .eq("tenant_id", access.context.tenant.id)
    .maybeSingle();
  if (clientError || !client) {
    return operationalJson({ error: QUOTE_MESSAGES.notFound }, { status: 404 });
  }
  const requested = Number(request.nextUrl.searchParams.get("page") ?? "1");
  const page = Number.isInteger(requested) && requested > 0 && requested <= 10000 ? requested : 1;
  const { data, error } = await access.supabase.rpc("list_client_quotes", {
    p_client_id: id,
    p_page: page,
  });
  if (error) {
    return operationalJson({ error: "No se pudieron cargar los presupuestos" }, { status: 500 });
  }
  const payload = data as { ok?: boolean; error?: string };
  if (!payload?.ok) {
    return operationalJson({ error: QUOTE_MESSAGES.notFound }, { status: 404 });
  }
  return operationalJson(data);
}
