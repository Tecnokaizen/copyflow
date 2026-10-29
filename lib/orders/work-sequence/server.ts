import type { SupabaseClient } from "@supabase/supabase-js";

import { tenantHasFeature } from "@/lib/features/tenant-has-feature";
import { ORDER_FEATURE_CODES } from "@/lib/orders/order-features";
import { canEditWorkSteps } from "@/lib/orders/work-sequence/access";
import { sortWorkStages, toWorkStageDto, toWorkStepDto } from "@/lib/orders/work-sequence/normalize";
import {
  WORK_ORDER_HEAD_SELECT,
  WORK_STAGE_SELECT,
  WORK_STEP_SELECT,
} from "@/lib/orders/work-sequence/select";
import type {
  WorkSequenceDto,
  WorkStageDto,
  WorkStepDto,
} from "@/lib/orders/work-sequence/types";

// SUR4 E8: server-side reads of the work sequence. Always scoped to the tenant
// of the session; RLS adds membership + the order_work_sequence feature.

type Row = Record<string, unknown>;

export type OrderHead = {
  id: string;
  row_version: string;
  archived: boolean;
};

export function workSequenceEnabled(supabase: SupabaseClient, tenantId: string) {
  return tenantHasFeature(supabase, tenantId, ORDER_FEATURE_CODES.workSequence);
}

export async function loadOrderHead(
  supabase: SupabaseClient,
  tenantId: string,
  orderId: string
): Promise<{ ok: true; order: OrderHead | null } | { ok: false }> {
  const { data, error } = await supabase
    .from("orders")
    .select(WORK_ORDER_HEAD_SELECT)
    .eq("tenant_id", tenantId)
    .eq("id", orderId)
    .maybeSingle();
  if (error) return { ok: false };
  if (!data) return { ok: true, order: null };
  const row = data as Row;
  return {
    ok: true,
    order: {
      id: String(row.id),
      row_version: String(row.row_version),
      archived: row.archived_at != null,
    },
  };
}

export async function loadWorkSteps(
  supabase: SupabaseClient,
  tenantId: string,
  orderId: string
): Promise<WorkStepDto[] | null> {
  const { data, error } = await supabase
    .from("order_work_steps")
    .select(WORK_STEP_SELECT)
    .eq("tenant_id", tenantId)
    .eq("order_id", orderId)
    .order("position", { ascending: true });
  if (error) return null;
  return ((data ?? []) as unknown as Row[]).map(toWorkStepDto).sort((a, b) => a.position - b.position);
}

export async function loadWorkStages(
  supabase: SupabaseClient,
  tenantId: string,
  options: { activeOnly: boolean }
): Promise<WorkStageDto[] | null> {
  let query = supabase.from("work_stages").select(WORK_STAGE_SELECT).eq("tenant_id", tenantId);
  if (options.activeOnly) {
    query = query.eq("active", true);
  }
  const { data, error } = await query
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  if (error) return null;
  return sortWorkStages(((data ?? []) as unknown as Row[]).map(toWorkStageDto));
}

export async function loadWorkSequence(
  supabase: SupabaseClient,
  tenantId: string,
  order: OrderHead,
  role: string | null | undefined
): Promise<WorkSequenceDto | null> {
  const [steps, stages] = await Promise.all([
    loadWorkSteps(supabase, tenantId, order.id),
    loadWorkStages(supabase, tenantId, { activeOnly: true }),
  ]);
  if (!steps || !stages) return null;
  return {
    order_id: order.id,
    row_version: order.row_version,
    archived: order.archived,
    can_edit: canEditWorkSteps(role) && !order.archived,
    steps,
    stages,
  };
}
