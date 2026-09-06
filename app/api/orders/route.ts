import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentContext } from "@/lib/tenant/current-context";
import type { SupabaseClient } from "@supabase/supabase-js";

const OPERATIVE_ROLES = ["owner", "admin", "manager", "staff"] as const;
const PRIORITIES = ["normal", "high", "urgent"] as const;

type Priority = (typeof PRIORITIES)[number];

const ORDER_SELECT = `
  *,
  client:clients(*),
  service:services(*),
  status:order_statuses(*),
  entry_channel:entry_channels(*),
  assigned_team_member:team_members(*),
  order_context:order_contexts(*),
  file_status:file_statuses(*),
  quote_status:quote_statuses(*),
  payment_status:payment_statuses(*),
  delivery_method:delivery_methods(*)
`;

function emptyToNull(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseDueAt(value: unknown): { ok: true; dueAt: string | null } | { ok: false } {
  if (value == null) {
    return { ok: true, dueAt: null };
  }

  if (typeof value !== "string") {
    return { ok: false };
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return { ok: true, dueAt: null };
  }

  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) {
    return { ok: false };
  }

  return { ok: true, dueAt: date.toISOString() };
}

async function belongsToTenant(
  supabase: SupabaseClient,
  table: string,
  id: string,
  tenantId: string
) {
  const { data, error } = await supabase
    .from(table)
    .select("id")
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  return !error && Boolean(data);
}

export async function GET() {
  const context = await getCurrentContext();

  if (!context) {
    return NextResponse.json(
      { error: "Unauthorized or tenant access denied" },
      { status: 403 }
    );
  }

  const supabase = await createClient();

  const { data: orders, error } = await supabase
    .from("orders")
    .select(ORDER_SELECT)
    .eq("tenant_id", context.tenant.id);

  if (error) {
    return NextResponse.json(
      {
        error: "Could not load orders",
        detail: error.message,
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    tenant: context.tenant.slug,
    count: orders.length,
    orders,
  });
}

export async function POST(request: NextRequest) {
  const context = await getCurrentContext();

  if (!context) {
    return NextResponse.json(
      { error: "Unauthorized or tenant access denied" },
      { status: 403 }
    );
  }

  if (
    !OPERATIVE_ROLES.includes(
      context.membership.role as (typeof OPERATIVE_ROLES)[number]
    )
  ) {
    return NextResponse.json(
      { error: "Unauthorized or tenant access denied" },
      { status: 403 }
    );
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const payload = body as Record<string, unknown>;
  const title =
    typeof payload.title === "string" ? payload.title.trim() : "";

  if (!title) {
    return NextResponse.json(
      { error: "title is required" },
      { status: 400 }
    );
  }

  const priorityValue = emptyToNull(payload.priority) ?? "normal";

  if (!PRIORITIES.includes(priorityValue as Priority)) {
    return NextResponse.json(
      { error: "Invalid priority" },
      { status: 400 }
    );
  }

  const priority = priorityValue as Priority;
  const dueAtResult = parseDueAt(payload.due_at);

  if (!dueAtResult.ok) {
    return NextResponse.json(
      { error: "Invalid due_at" },
      { status: 400 }
    );
  }

  const clientId = emptyToNull(payload.client_id);
  const serviceId = emptyToNull(payload.service_id);
  const entryChannelId = emptyToNull(payload.entry_channel_id);
  const orderContextId = emptyToNull(payload.order_context_id);
  const assignedTeamMemberId = emptyToNull(payload.assigned_team_member_id);
  const description = emptyToNull(payload.description);
  const notes = emptyToNull(payload.notes);

  const supabase = await createClient();
  const tenantId = context.tenant.id;

  const relationChecks: Array<{ table: string; id: string | null }> = [
    { table: "clients", id: clientId },
    { table: "services", id: serviceId },
    { table: "entry_channels", id: entryChannelId },
    { table: "order_contexts", id: orderContextId },
    { table: "team_members", id: assignedTeamMemberId },
  ];

  for (const relation of relationChecks) {
    if (!relation.id) {
      continue;
    }

    const ok = await belongsToTenant(
      supabase,
      relation.table,
      relation.id,
      tenantId
    );

    if (!ok) {
      return NextResponse.json(
        { error: "Invalid related record for current tenant" },
        { status: 400 }
      );
    }
  }

  const { data: initialStatuses, error: initialStatusError } = await supabase
    .from("order_statuses")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("active", true)
    .eq("is_initial", true)
    .limit(2);

  if (
    initialStatusError ||
    !initialStatuses ||
    initialStatuses.length !== 1
  ) {
    return NextResponse.json(
      { error: "Tenant has no initial order status configured" },
      { status: 500 }
    );
  }

  const { data: order, error: insertError } = await supabase
    .from("orders")
    .insert({
      tenant_id: tenantId,
      title,
      description,
      client_id: clientId,
      service_id: serviceId,
      assigned_team_member_id: assignedTeamMemberId,
      status_id: initialStatuses[0].id,
      entry_channel_id: entryChannelId,
      order_context_id: orderContextId,
      priority,
      due_at: dueAtResult.dueAt,
      notes,
      created_by: context.user.id,
    })
    .select(ORDER_SELECT)
    .single();

  if (insertError || !order) {
    return NextResponse.json(
      { error: "Could not create order" },
      { status: 500 }
    );
  }

  return NextResponse.json(
    {
      ok: true,
      tenant: context.tenant.slug,
      order,
    },
    { status: 201 }
  );
}
