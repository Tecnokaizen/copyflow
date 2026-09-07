import type { TeamMemberPayload } from "@/lib/team/types";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normalizeOptionalText(
  value: unknown
): { ok: true; value: string | null } | { ok: false } {
  if (value == null) {
    return { ok: true, value: null };
  }

  if (typeof value !== "string") {
    return { ok: false };
  }

  const trimmed = value.trim();
  return { ok: true, value: trimmed ? trimmed : null };
}

function normalizeBoolean(
  value: unknown,
  fallback: boolean
): { ok: true; value: boolean } | { ok: false } {
  if (value == null) {
    return { ok: true, value: fallback };
  }

  if (typeof value === "boolean") {
    return { ok: true, value };
  }

  if (value === "true" || value === 1 || value === "1") {
    return { ok: true, value: true };
  }

  if (value === "false" || value === 0 || value === "0") {
    return { ok: true, value: false };
  }

  return { ok: false };
}

export function parseTeamMemberPayload(
  payload: Record<string, unknown>
): { ok: true; data: TeamMemberPayload } | { ok: false } {
  if (typeof payload.name !== "string") {
    return { ok: false };
  }

  const name = payload.name.trim();
  if (!name) {
    return { ok: false };
  }

  const jobTitle = normalizeOptionalText(payload.job_title);
  const department = normalizeOptionalText(payload.department);
  const active = normalizeBoolean(payload.active, true);
  const canReceiveOrders = normalizeBoolean(payload.can_receive_orders, true);

  if (!jobTitle.ok || !department.ok || !active.ok || !canReceiveOrders.ok) {
    return { ok: false };
  }

  return {
    ok: true,
    data: {
      name,
      job_title: jobTitle.value,
      department: department.value,
      active: active.value,
      can_receive_orders: canReceiveOrders.value,
    },
  };
}

export function isUuid(value: string) {
  return UUID_PATTERN.test(value);
}

export { UUID_PATTERN };
