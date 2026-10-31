import { NextRequest } from "next/server";

import { operationalJson } from "@/lib/http/operational-cache";
import { canEditWorkSteps } from "@/lib/orders/work-sequence/access";
import { WORK_SEQUENCE_MESSAGES, workSequenceErrorResponse } from "@/lib/orders/work-sequence/errors";
import { isUuidValue, parseStepDoneBody } from "@/lib/orders/work-sequence/payload";
import { loadOrderHead, loadWorkSequence, workSequenceEnabled } from "@/lib/orders/work-sequence/server";
import { createClient } from "@/lib/supabase/server";
import { requireCurrentAccess } from "@/lib/tenant/access-response";

// SUR4 E8 · contract §9: mark or undo one step. Idempotent and without
// version (D5/R4), but it bumps orders.row_version, which is returned.

type RouteContext = { params: Promise<{ id: string; stepId: string }> };

const ROUTE = "POST /api/orders/[id]/work-steps/[stepId]/done";

function fail(failure: Parameters<typeof workSequenceErrorResponse>[0], scope: "order" | "step") {
  const mapped = workSequenceErrorResponse(failure, scope);
  return operationalJson(mapped.body, { status: mapped.status });
}

export async function POST(request: NextRequest, context: RouteContext) {
  const access = await requireCurrentAccess(ROUTE);
  if (!access.ok) {
    return access.response;
  }
  const { id, stepId } = await context.params;
  if (!isUuidValue(id) || !isUuidValue(stepId)) {
    return fail({ error: "not_found" }, "step");
  }

  const supabase = await createClient();
  const tenantId = access.context.tenant.id;
  if (!(await workSequenceEnabled(supabase, tenantId))) {
    return fail({ error: "not_found" }, "step");
  }

  const role = access.context.membership.role;
  if (!canEditWorkSteps(role)) {
    return fail({ error: "forbidden" }, "step");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  const parsed = parseStepDoneBody(body);
  if (!parsed.ok) {
    return fail(parsed, "step");
  }

  // The step must belong to the order in the URL, inside the session tenant.
  const { data: stepRow, error: stepError } = await supabase
    .from("order_work_steps")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("order_id", id)
    .eq("id", stepId)
    .maybeSingle();
  if (stepError) {
    return operationalJson({ error: WORK_SEQUENCE_MESSAGES.saveSteps }, { status: 500 });
  }
  if (!stepRow) {
    return fail({ error: "not_found" }, "step");
  }

  const { data, error } = await supabase.rpc("set_order_work_step_done_v1", {
    p_step_id: stepId,
    p_done: parsed.done,
    p_executed_by: parsed.executedBy,
  });
  if (error) {
    console.error(`[${ROUTE}] set_order_work_step_done_v1 failed`, { tenantId, code: error.code });
    return operationalJson({ error: WORK_SEQUENCE_MESSAGES.saveSteps }, { status: 500 });
  }

  const result = (data ?? {}) as { ok?: boolean; changed?: boolean; row_version?: unknown };
  if (result.ok !== true) {
    return fail(result, "step");
  }

  const rowVersion = String(result.row_version);
  const head = await loadOrderHead(supabase, tenantId, id);
  const sequence =
    head.ok && head.order
      ? await loadWorkSequence(supabase, tenantId, { ...head.order, row_version: rowVersion }, role)
      : null;
  const step = sequence?.steps.find((candidate) => candidate.id === stepId) ?? null;

  return operationalJson({
    changed: result.changed === true,
    step,
    ...(sequence ?? {}),
    row_version: rowVersion,
  });
}
