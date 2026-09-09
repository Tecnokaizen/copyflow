import {
  type InvitableRole,
  isInvitableRole,
} from "@/lib/auth/membership-roles";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isPlainObject(
  value: unknown
): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyAllowedKeys(
  record: Record<string, unknown>,
  allowed: readonly string[]
) {
  const allowedSet = new Set(allowed);
  return Object.keys(record).every((key) => allowedSet.has(key));
}

export function isUuid(value: string) {
  return UUID_PATTERN.test(value);
}

export function parseInvitationCreatePayload(
  payload: unknown
):
  | { ok: true; email: string; role: InvitableRole }
  | { ok: false } {
  if (!isPlainObject(payload)) {
    return { ok: false };
  }

  if (!hasOnlyAllowedKeys(payload, ["email", "role"])) {
    return { ok: false };
  }

  if (typeof payload.email !== "string" || typeof payload.role !== "string") {
    return { ok: false };
  }

  const email = payload.email.trim();
  const role = payload.role.trim();

  if (!email || !isInvitableRole(role)) {
    return { ok: false };
  }

  return { ok: true, email, role };
}

export function parseInvitationAcceptPayload(
  payload: unknown
): { ok: true; token: string } | { ok: false } {
  if (!isPlainObject(payload)) {
    return { ok: false };
  }

  if (!hasOnlyAllowedKeys(payload, ["token"])) {
    return { ok: false };
  }

  if (typeof payload.token !== "string") {
    return { ok: false };
  }

  const token = payload.token.trim();
  if (!token || token.length !== 64 || !/^[0-9a-f]+$/i.test(token)) {
    return { ok: false };
  }

  return { ok: true, token };
}

export function parseAccessPatchPayload(
  payload: unknown
):
  | { ok: true; action: "change_role"; role: InvitableRole }
  | { ok: true; action: "set_active"; active: boolean }
  | { ok: false } {
  if (!isPlainObject(payload)) {
    return { ok: false };
  }

  const action = payload.action;

  if (action === "change_role") {
    if (!hasOnlyAllowedKeys(payload, ["action", "role"])) {
      return { ok: false };
    }

    if (typeof payload.role !== "string") {
      return { ok: false };
    }

    const role = payload.role.trim();
    if (!isInvitableRole(role)) {
      return { ok: false };
    }

    return { ok: true, action: "change_role", role };
  }

  if (action === "set_active") {
    if (!hasOnlyAllowedKeys(payload, ["action", "active"])) {
      return { ok: false };
    }

    if (typeof payload.active !== "boolean") {
      return { ok: false };
    }

    return { ok: true, action: "set_active", active: payload.active };
  }

  return { ok: false };
}
