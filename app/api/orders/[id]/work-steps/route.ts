import { NextRequest } from "next/server";

import { operationalJson } from "@/lib/http/operational-cache";
import { canEditWorkSteps } from "@/lib/orders/work-sequence/access";
import { WORK_SEQUENCE_MESSAGES, workSequenceErrorResponse } from "@/lib/orders/work-sequence/errors";
import { isUuidValue, parseReplaceStepsBody } from "@/lib/orders/work-sequence/payload";
import { loadOrderHead, loadWorkSequence, workSequenceEnabled } from "@/lib/orders/work-sequence/server";
import { createClient } from "@/lib/supabase/server";
import { requireCurrentAccess } from "@/lib/tenant/access-response";

// SUR4 E8 · contract §9: the order's work sequence. Tenant from the session;
// without the order_work_sequence feature every answer is a 404.

type RouteContext = { params: Promise<{ id: string }> };

const notFound = () =>
  operationalJson({ error: WORK_SEQUENCE_MESSAGES.orderNotFound, code: "not_found" }, { status: 404 });

export async function GET(_request: NextRequest, context: RouteContext) {
  const access = await requireCurrentAccess("GET /api/orders/[id]/work-steps");
  if (!access.ok) {
    return access.response;
  }
  const { id } = await context.params;
  if (!isUuidValue(id)) {
    return notFound();
  }

  const supabase = await createClient();
  const tenantId = access.context.tenant.id;
  if (!(await workSequenceEnabled(supabase, tenantId))) {
    return notFound();
  }

  const head = await loadOrderHead(supabase, tenantId, id);
  if (!head.ok) {
    return operationalJson({ error: WORK_SEQUENCE_MESSAGES.loadSteps }, { status: 500 });
  }
  if (!head.order) {
    return notFound();
  }

  const sequence = await loadWorkSequence(supabase, tenantId, head.order, access.context.membership.role);
  if (!sequence) {
    return operationalJson({ error: WORK_SEQUENCE_MESSAGES.loadSteps }, { status: 500 });
  }
  return operationalJson(sequence);
}

export async function PUT(request: NextRequest, context: RouteContext) {
  const access = await requireCurrentAccess("PUT /api/orders/[id]/work-steps");
  if (!access.ok) {
    return access.response;
  }
  const { id } = await context.params;
  if (!isUuidValue(id)) {
    return notFound();
  }

  const supabase = await createClient();
  const tenantId = access.context.tenant.id;
  if (!(await workSequenceEnabled(supabase, tenantId))) {
    return notFound();
  }

  const role = access.context.membership.role;
  if (!canEditWorkSteps(role)) {
    const denied = workSequenceErrorResponse({ error: "forbidden" }, "order");
    return operationalJson(denied.body, { status: denied.status });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  const parsed = parseReplaceStepsBody(body);
  if (!parsed.ok) {
    const invalid = workSequenceErrorResponse(parsed, "order");
    return operationalJson(invalid.body, { status: invalid.status });
  }

  // The order must belong to the tenant of the session (a person with two
  // memberships cannot write another tenant's order from this host).
  const head = await loadOrderHead(supabase, tenantId, id);
  if (!head.ok) {
    return operationalJson({ error: WORK_SEQUENCE_MESSAGES.saveSteps }, { status: 500 });
  }
  if (!head.order) {
    return notFound();
  }

  const { data, error } = await supabase.rpc("replace_order_work_steps_v1", {
    p_order_id: id,
    p_expected_row_version: parsed.expectedVersion,
    p_steps: parsed.steps,
  });
  if (error) {
    console.error("[PUT /api/orders/[id]/work-steps] replace_order_work_steps_v1 failed", {
      tenantId,
      code: error.code,
    });
    return operationalJson({ error: WORK_SEQUENCE_MESSAGES.saveSteps }, { status: 500 });
  }

  const result = (data ?? {}) as { ok?: boolean; changed?: boolean; row_version?: unknown };
  if (result.ok !== true) {
    const failure = workSequenceErrorResponse(result, "order");
    return operationalJson(failure.body, { status: failure.status });
  }

  const rowVersion = String(result.row_version);
  const sequence = await loadWorkSequence(
    supabase,
    tenantId,
    { ...head.order, row_version: rowVersion },
    role
  );
  return operationalJson({
    changed: result.changed === true,
    ...(sequence ?? {}),
    row_version: rowVersion,
  });
}
