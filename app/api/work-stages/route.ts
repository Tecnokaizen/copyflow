import { NextRequest } from "next/server";

import { operationalJson } from "@/lib/http/operational-cache";
import { canManageWorkStages } from "@/lib/orders/work-sequence/access";
import { WORK_SEQUENCE_MESSAGES, workSequenceErrorResponse } from "@/lib/orders/work-sequence/errors";
import { toWorkStageDto } from "@/lib/orders/work-sequence/normalize";
import { parseCreateStageBody, parseUpdateStageBody } from "@/lib/orders/work-sequence/payload";
import { WORK_STAGE_SELECT } from "@/lib/orders/work-sequence/select";
import { loadWorkStages, workSequenceEnabled } from "@/lib/orders/work-sequence/server";
import { createClient } from "@/lib/supabase/server";
import { requireCurrentAccess } from "@/lib/tenant/access-response";

// SUR4 E8 · contract §9: the tenant's catalog of work stages («Fases de
// trabajo»). Any member with the feature reads it; owner, admin and manager
// write it through upsert_work_stage_v1 / create_suggested_work_stages_v1.
// Stages are never deleted: they are deactivated.

function respond(failure: Parameters<typeof workSequenceErrorResponse>[0]) {
  const mapped = workSequenceErrorResponse(failure, "stage");
  return operationalJson(mapped.body, { status: mapped.status });
}

async function readJson(request: NextRequest) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

type Supabase = Awaited<ReturnType<typeof createClient>>;

async function listWithStages(supabase: Supabase, tenantId: string, role: string) {
  const stages = await loadWorkStages(supabase, tenantId, { activeOnly: false });
  return stages ? { stages, can_manage: canManageWorkStages(role) } : null;
}

export async function GET() {
  const access = await requireCurrentAccess("GET /api/work-stages");
  if (!access.ok) {
    return access.response;
  }
  const supabase = await createClient();
  const tenantId = access.context.tenant.id;
  if (!(await workSequenceEnabled(supabase, tenantId))) {
    return respond({ error: "not_found" });
  }
  const list = await listWithStages(supabase, tenantId, access.context.membership.role);
  if (!list) {
    return operationalJson({ error: WORK_SEQUENCE_MESSAGES.loadStages }, { status: 500 });
  }
  return operationalJson(list);
}

export async function POST(request: NextRequest) {
  const access = await requireCurrentAccess("POST /api/work-stages");
  if (!access.ok) {
    return access.response;
  }
  const supabase = await createClient();
  const tenantId = access.context.tenant.id;
  if (!(await workSequenceEnabled(supabase, tenantId))) {
    return respond({ error: "not_found" });
  }
  const role = access.context.membership.role;
  if (!canManageWorkStages(role)) {
    return respond({ error: "forbidden" });
  }

  const parsed = parseCreateStageBody(await readJson(request));
  if (!parsed.ok) {
    return respond(parsed);
  }

  const { data, error } =
    parsed.kind === "suggested"
      ? await supabase.rpc("create_suggested_work_stages_v1", { p_tenant_id: tenantId })
      : await supabase.rpc("upsert_work_stage_v1", {
          p_tenant_id: tenantId,
          p_stage_id: null,
          p_name: parsed.name,
          p_icon: parsed.icon,
          p_active: parsed.active,
          p_sort_order: parsed.sortOrder,
        });
  if (error) {
    console.error("[POST /api/work-stages] RPC failed", { tenantId, code: error.code });
    return operationalJson({ error: WORK_SEQUENCE_MESSAGES.saveStages }, { status: 500 });
  }

  const result = (data ?? {}) as { ok?: boolean; changed?: boolean; created?: unknown; stage?: unknown };
  if (result.ok !== true) {
    return respond(result);
  }

  const list = await listWithStages(supabase, tenantId, role);
  const created = parsed.kind === "suggested" ? Number(result.created) || 0 : result.changed === true ? 1 : 0;
  return operationalJson(
    {
      changed: result.changed === true,
      created,
      ...(result.stage && typeof result.stage === "object"
        ? { stage: toWorkStageDto(result.stage as Record<string, unknown>) }
        : {}),
      ...(list ?? {}),
    },
    { status: created > 0 ? 201 : 200 }
  );
}

export async function PATCH(request: NextRequest) {
  const access = await requireCurrentAccess("PATCH /api/work-stages");
  if (!access.ok) {
    return access.response;
  }
  const supabase = await createClient();
  const tenantId = access.context.tenant.id;
  if (!(await workSequenceEnabled(supabase, tenantId))) {
    return respond({ error: "not_found" });
  }
  const role = access.context.membership.role;
  if (!canManageWorkStages(role)) {
    return respond({ error: "forbidden" });
  }

  const parsed = parseUpdateStageBody(await readJson(request));
  if (!parsed.ok) {
    return respond(parsed);
  }

  // upsert_work_stage_v1 takes the whole stage: fill what the body leaves out
  // from the current row of this tenant (404 for another tenant's id).
  const { data: current, error: currentError } = await supabase
    .from("work_stages")
    .select(WORK_STAGE_SELECT)
    .eq("tenant_id", tenantId)
    .eq("id", parsed.id)
    .maybeSingle();
  if (currentError) {
    return operationalJson({ error: WORK_SEQUENCE_MESSAGES.saveStages }, { status: 500 });
  }
  if (!current) {
    return respond({ error: "not_found" });
  }
  const stage = toWorkStageDto(current as Record<string, unknown>);

  const { data, error } = await supabase.rpc("upsert_work_stage_v1", {
    p_tenant_id: tenantId,
    p_stage_id: stage.id,
    p_name: parsed.name ?? stage.name,
    p_icon: parsed.icon ?? stage.icon,
    p_active: parsed.active ?? null,
    p_sort_order: parsed.sortOrder ?? null,
  });
  if (error) {
    console.error("[PATCH /api/work-stages] upsert_work_stage_v1 failed", { tenantId, code: error.code });
    return operationalJson({ error: WORK_SEQUENCE_MESSAGES.saveStages }, { status: 500 });
  }

  const result = (data ?? {}) as { ok?: boolean; changed?: boolean; stage?: unknown };
  if (result.ok !== true) {
    return respond(result);
  }

  const list = await listWithStages(supabase, tenantId, role);
  return operationalJson({
    changed: result.changed === true,
    ...(result.stage && typeof result.stage === "object"
      ? { stage: toWorkStageDto(result.stage as Record<string, unknown>) }
      : {}),
    ...(list ?? {}),
  });
}
