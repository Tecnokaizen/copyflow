import {
  canAssignMembershipRole,
  isMembershipRole,
} from "@/lib/auth/membership-roles";

export const LAST_OWNER_REQUIRED_MESSAGE =
  "Debe existir al menos un propietario en la organización.";

export function countOtherActiveOwners(
  memberships: Array<{ user_id: string; role: string; active: boolean }>,
  targetUserId: string
) {
  return memberships.filter(
    (row) =>
      row.role === "owner" &&
      row.active &&
      row.user_id !== targetUserId
  ).length;
}

export function canManageMembershipTarget(
  actorRole: string | null | undefined,
  targetRole: string | null | undefined,
  options?: { otherActiveOwners?: number }
) {
  if (!isMembershipRole(actorRole) || !isMembershipRole(targetRole)) {
    return false;
  }

  if (targetRole === "owner") {
    return actorRole === "owner" && (options?.otherActiveOwners ?? 0) >= 1;
  }

  return canAssignMembershipRole(actorRole, targetRole);
}

export function ownerProtectionMessage(input: {
  targetRole: string | null | undefined;
  otherActiveOwners: number;
  makingInactive?: boolean;
}) {
  if (input.targetRole !== "owner") {
    return null;
  }

  if (input.otherActiveOwners >= 1) {
    return null;
  }

  return LAST_OWNER_REQUIRED_MESSAGE;
}
