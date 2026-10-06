import { NextRequest } from "next/server";
import { operationalJson } from "@/lib/http/operational-cache";
import { requireQuotesAccess } from "@/lib/quotes/guard";
import { QUOTE_MESSAGES } from "@/lib/quotes/errors";
import { commercialQuoteInTenant, commercialFailureBody, interpretCommercialDatabaseError } from "@/lib/quotes/commercial";
import { parseQuoteConversion } from "@/lib/quotes/conversion";
import { transitionFailure } from "@/lib/quotes/transition-result";
import { isUuid } from "@/lib/team/payload";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  const access = await requireQuotesAccess();
  if (!access.ok) {
    return access.response;
  }

  const { id } = await context.params;
  if (!isUuid(id)) {
    return operationalJson({ error: QUOTE_MESSAGES.notFound }, { status: 404 });
  }

  const scope = await commercialQuoteInTenant(access.supabase,id,access.context.tenant.id);
  if (scope) return operationalJson(commercialFailureBody(scope),{status:scope.status});
  let body; try { body=await request.json(); } catch { return operationalJson({error:QUOTE_MESSAGES.invalid},{status:400}); }
  const payload=parseQuoteConversion(body);
  if (!payload) return operationalJson({error:QUOTE_MESSAGES.invalid},{status:422});
  const { data,error }=await access.supabase.rpc("convert_quote_to_order",{
    p_quote_id:id,p_store_id:payload.store_id,p_service_id:payload.service_id,
    p_assigned_team_member_id:payload.assigned_team_member_id,p_priority:payload.priority,
    p_due_at:payload.due_at,p_expected_row_version:payload.expected_row_version,
  });
  if (error) {const failure=interpretCommercialDatabaseError(error,QUOTE_MESSAGES.convert);return operationalJson(commercialFailureBody(failure),{status:failure.status});}
  if (!data?.ok) {const failure=transitionFailure(data ?? {});return operationalJson(failure.body,{status:failure.status});}
  return operationalJson({ok:true,tenant:access.context.tenant.slug,order_id:data.order_id,reference:data.reference,
    order:{id:data.order_id,reference:data.reference},quote:{converted_order_id:data.order_id},created:data.created===true,replayed:data.replayed===true});
}
