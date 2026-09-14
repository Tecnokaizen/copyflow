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
  const email = normalizeOptionalText(payload.email);
  const phone = normalizeOptionalText(payload.phone);
  const active = normalizeBoolean(payload.active, true);
  const canReceiveOrders = normalizeBoolean(payload.can_receive_orders, true);
  const userId = normalizeOptionalUserId(payload.user_id);

  if (
    !jobTitle.ok ||
    !department.ok ||
    !email.ok ||
    !phone.ok ||
    !active.ok ||
    !canReceiveOrders.ok ||
    !userId.ok
  ) {
    return { ok: false };
  }

  return {
    ok: true,
    data: {
      name,
      job_title: jobTitle.value,
      department: department.value,
      email: email.value,
      phone: phone.value,
      active: active.value,
      can_receive_orders: canReceiveOrders.value,
      user_id: userId.value,
    },
  };
}

function normalizeOptionalUserId(
  value: unknown
): { ok: true; value: string | null } | { ok: false } {
  if (value == null || value === "") {
    return { ok: true, value: null };
  }

  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    return { ok: false };
  }

  return { ok: true, value };
}

export function isUuid(value: string) {
  return UUID_PATTERN.test(value);
}

export { UUID_PATTERN };
