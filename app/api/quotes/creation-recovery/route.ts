import { NextRequest } from "next/server";
import { operationalJson } from "@/lib/http/operational-cache";
import { requireQuotesAccess } from "@/lib/quotes/guard";
import { commercialFailureBody, interpretCommercialDatabaseError } from "@/lib/quotes/commercial";
import { QUOTE_MESSAGES } from "@/lib/quotes/errors";
import { isUuid } from "@/lib/team/payload";

async function invoke(access: Extract<Awaited<ReturnType<typeof requireQuotesAccess>>, { ok: true }>, name: string, operation: string | null) {
  const { data, error } = await access.supabase.rpc(name, { p_tenant_id: access.context.tenant.id, p_creation_id: operation });
  if (error) {
    const failure = interpretCommercialDatabaseError(error, QUOTE_MESSAGES.create);
    return operationalJson(commercialFailureBody(failure), { status: failure.status });
  }
  if (data?.ok !== true) return operationalJson({ error: QUOTE_MESSAGES.notFound }, { status: 404 });
  if (name === 'ack_quote_draft_creation_v1') {
    if (data.quote_id !== operation) return operationalJson({ error: QUOTE_MESSAGES.create }, { status: 500 });
    return operationalJson({ ok: true, quote_id: operation });
  }
  if (!Array.isArray(data.receipts) || data.receipts.some((r: { operation_id: string; quote_id: string }) => !isUuid(r.operation_id) || r.quote_id !== r.operation_id || (operation && r.operation_id !== operation)))
    return operationalJson({ error: QUOTE_MESSAGES.create }, { status: 500 });
  return operationalJson({ receipts: data.receipts.map((r: { operation_id: string; quote_id: string; reference: string; created_at: string; acknowledged_at: string | null }) => ({
    operation_id: r.operation_id, quote_id: r.quote_id, reference: r.reference, created_at: r.created_at, acknowledged_at: r.acknowledged_at,
  })) });
}
export async function GET(request: NextRequest) {
  const access = await requireQuotesAccess();
  if (!access.ok) return access.response;
  const operation = request.nextUrl.searchParams.get('op');
  if (operation !== null && !isUuid(operation)) return operationalJson({ error: QUOTE_MESSAGES.invalid }, { status: 400 });
  return invoke(access, 'recover_quote_draft_creations_v1', operation);
}
export async function POST(request: NextRequest) {
  const access = await requireQuotesAccess();
  if (!access.ok) return access.response;
  let body: unknown;
  try { body = await request.json(); } catch { return operationalJson({ error: QUOTE_MESSAGES.invalid }, { status: 400 }); }
  if (!body || typeof body !== 'object' || !('operation_id' in body) || typeof body.operation_id !== 'string' || !isUuid(body.operation_id))
    return operationalJson({ error: QUOTE_MESSAGES.invalid }, { status: 400 });
  return invoke(access, 'ack_quote_draft_creation_v1', body.operation_id);
}
