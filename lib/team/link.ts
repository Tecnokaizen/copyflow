import { isUuid } from "@/lib/team/payload";

export type TeamAccessUser = {
  user_id: string;
  full_name: string | null;
  role: string;
  active: boolean;
  team_member_id: string | null;
};

export type LinkChangeInput = {
  targetMemberId: string;
  sessionTenantId: string;
  userId: string | null;
  membership: { tenantId: string; userId: string } | null;
  existingLinkMemberId: string | null;
};

export type LinkChangeResult =
  | { ok: true; userId: string | null }
  | {
      ok: false;
      code: "tenant_mismatch" | "membership_missing" | "already_linked";
    };

export function parseLinkBody(
  body: unknown
): { ok: true; userId: string | null } | { ok: false } {
  if (!body || typeof body !== "object") {
    return { ok: false };
  }

  const record = body as Record<string, unknown>;
  if (!("user_id" in record)) {
    return { ok: false };
  }

  if (record.user_id === null) {
    return { ok: true, userId: null };
  }

  if (typeof record.user_id !== "string" || !isUuid(record.user_id)) {
    return { ok: false };
  }

  return { ok: true, userId: record.user_id };
}

/**
 * Explicit user ↔ team_member link only. Never match by name/email.
 * A user may be linked to at most one team_member per tenant.
 */
export function evaluateLinkChange(input: LinkChangeInput): LinkChangeResult {
  if (input.userId === null) {
    return { ok: true, userId: null };
  }

  if (!input.membership) {
    return { ok: false, code: "membership_missing" };
  }

  if (
    input.membership.tenantId !== input.sessionTenantId ||
    input.membership.userId !== input.userId
  ) {
    return { ok: false, code: "tenant_mismatch" };
  }

  if (
    input.existingLinkMemberId &&
    input.existingLinkMemberId !== input.targetMemberId
  ) {
    return { ok: false, code: "already_linked" };
  }

  return { ok: true, userId: input.userId };
}

export function publicTeamLinkError(
  status: number,
  payload: { error?: string; code?: string } | null
) {
  if (payload?.code === "already_linked") {
    return "Ese usuario ya está asignado a otro trabajador.";
  }

  if (payload?.code === "membership_missing") {
    return "Ese usuario no tiene acceso a esta organización.";
  }

  if (payload?.code === "tenant_mismatch") {
    return "No se puede asignar un usuario de otra organización.";
  }

  if (status === 409) {
    return "Ese usuario ya está asignado a otro trabajador.";
  }

  if (status === 403) {
    return "No tienes permiso para asignar este usuario.";
  }

  if (status === 404) {
    return "No se encontró este trabajador.";
  }

  if (status === 400) {
    return "Revisa los datos indicados.";
  }

  return payload?.error ?? "No se pudo asignar el usuario.";
}

export function accessUsersAvailableForMember(
  users: TeamAccessUser[],
  memberId: string
) {
  return users.filter(
    (user) =>
      user.active &&
      (user.team_member_id === null || user.team_member_id === memberId)
  );
}
