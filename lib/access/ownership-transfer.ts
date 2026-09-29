import { isMembershipRole } from "@/lib/auth/membership-roles";
import { isUuid } from "@/lib/access/payload";

export const OWNERSHIP_TRANSFER_CONFIRMATION = "TRANSFERIR";

export function canOfferOwnershipTransfer(input: {
  actorRole: string | null | undefined;
  actorUserId: string | null | undefined;
  targetUserId: string | null | undefined;
  targetRole: string | null | undefined;
  targetActive: boolean;
}) {
  if (input.actorRole !== "owner") {
    return false;
  }
  if (!input.actorUserId || !input.targetUserId) {
    return false;
  }
  if (input.actorUserId === input.targetUserId) {
    return false;
  }
  if (!input.targetActive) {
    return false;
  }
  if (!isMembershipRole(input.targetRole) || input.targetRole === "owner") {
    return false;
  }
  return true;
}

export function ownershipTransferDescription(input: {
  targetName: string;
  organizationName: string;
}) {
  const target = input.targetName.trim() || "Este usuario";
  const organization = input.organizationName.trim() || "esta organización";
  return `${target} pasará a ser la propietaria o el propietario de ${organization}. Tú pasarás a ser Administrador y dejarás de tener las funciones reservadas al propietario, incluida la gestión de determinadas operaciones de facturación y la transferencia de propiedad.`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function parseOwnershipTransferPayload(
  payload: unknown
): { ok: true; targetUserId: string } | { ok: false } {
  if (!isPlainObject(payload)) {
    return { ok: false };
  }
  if (Object.keys(payload).some((key) => key !== "target_user_id")) {
    return { ok: false };
  }
  if (typeof payload.target_user_id !== "string" || !isUuid(payload.target_user_id)) {
    return { ok: false };
  }
  return { ok: true, targetUserId: payload.target_user_id };
}
