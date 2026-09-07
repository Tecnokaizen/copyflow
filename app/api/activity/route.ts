import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentContext } from "@/lib/tenant/current-context";
import { canViewActivity, mapActivityEvent, unwrapRpcPayload } from "@/lib/activity/types";
import { statusForActivityRpcError } from "@/lib/activity/rpc-error";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parsePage(raw: string | null) {
  if (!raw) {
    return 1;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return 1;
  }

  return parsed;
}

function parsePageSize(raw: string | null) {
  if (!raw) {
    return 25;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return 25;
  }

  return Math.min(parsed, 100);
}

function parseOptionalText(raw: string | null) {
  const trimmed = raw?.trim();
  return trimmed ? trimmed : null;
}

function parseUuid(raw: string | null): { ok: true; value: string | null } | { ok: false } {
  const value = parseOptionalText(raw);
  if (!value) {
    return { ok: true, value: null };
  }

  if (!UUID_PATTERN.test(value)) {
    return { ok: false };
  }

  return { ok: true, value };
}

function parseTimestamp(
  raw: string | null
): { ok: true; value: string | null } | { ok: false } {
  const value = parseOptionalText(raw);
  if (!value) {
    return { ok: true, value: null };
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return { ok: false };
  }

  return { ok: true, value: date.toISOString() };
}

export async function GET(request: NextRequest) {
  const context = await getCurrentContext();

  if (!context) {
    return NextResponse.json(
      { error: "Unauthorized or tenant access denied" },
      { status: 403 }
    );
  }

  if (!canViewActivity(context.membership.role)) {
    return NextResponse.json(
      { error: "Unauthorized or tenant access denied" },
      { status: 403 }
    );
  }

  const params = request.nextUrl.searchParams;
  const userId = parseUuid(params.get("user_id"));
  const from = parseTimestamp(params.get("from"));
  const to = parseTimestamp(params.get("to"));

  if (!userId.ok || !from.ok || !to.ok) {
    return NextResponse.json(
      { error: "Invalid value" },
      { status: 400 }
    );
  }

  const supabase = await createClient();

  const { data, error } = await supabase.rpc("list_activity_log", {
    p_tenant_id: context.tenant.id,
    p_entity_type: parseOptionalText(params.get("entity_type")),
    p_action: parseOptionalText(params.get("action")),
    p_user_id: userId.value,
    p_from: from.value,
    p_to: to.value,
    p_page: parsePage(params.get("page")),
    p_page_size: parsePageSize(params.get("page_size")),
  });

  if (error || !data) {
    console.error("list_activity_log", error?.message ?? "unknown error");

    return NextResponse.json(
      { error: "Could not load activity" },
      { status: statusForActivityRpcError(error?.code) }
    );
  }

  const record = unwrapRpcPayload(data);
  const rawEvents = Array.isArray(record.events) ? record.events : [];
  const events = rawEvents
    .map((row) => mapActivityEvent(row))
    .filter((row): row is NonNullable<typeof row> => row !== null);

  return NextResponse.json({
    tenant: context.tenant.slug,
    events,
    total: Number(record.total ?? events.length) || 0,
    page: Number(record.page ?? 1) || 1,
    page_size: Number(record.page_size ?? 25) || 25,
    total_pages: Number(record.total_pages ?? 1) || 1,
    has_more: Boolean(record.has_more),
  });
}
