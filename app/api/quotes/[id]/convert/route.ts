import { NextRequest } from "next/server";
import { operationalJson } from "@/lib/http/operational-cache";
import { requireQuotesAccess } from "@/lib/quotes/guard";
import { QUOTE_MESSAGES, interpretConvertResult } from "@/lib/quotes/errors";
import { isUuid } from "@/lib/team/payload";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(_request: NextRequest, context: RouteContext) {
  const access = await requireQuotesAccess();
  if (!access.ok) {
    return access.response;
  }

  const { id } = await context.params;
  if (!isUuid(id)) {
    return operationalJson({ error: QUOTE_MESSAGES.notFound }, { status: 404 });
  }

  const { data, error } = await access.supabase.rpc("convert_quote_to_order", {
    p_quote_id: id,
  });

  if (error || !data || typeof data !== "object") {
    return operationalJson({ error: QUOTE_MESSAGES.convert }, { status: 500 });
  }

  const result = interpretConvertResult(data as { ok?: boolean; error?: string });
  if (!result.ok) {
    return operationalJson({ error: result.error }, { status: result.status });
  }

  return operationalJson({
    ok: true,
    tenant: access.context.tenant.slug,
    created: result.created,
    replayed: result.replayed,
    order: {
      id: result.orderId,
      reference: result.reference,
    },
  });
}
