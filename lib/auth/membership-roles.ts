export const MEMBERSHIP_ROLES = [
  "owner",
  "admin",
  "manager",
  "staff",
  "viewer",
] as const;

export type MembershipRole = (typeof MEMBERSHIP_ROLES)[number];

export const MEMBERSHIP_ROLE_LABELS = {
  owner: "Propietario",
  admin: "Administrador",
  manager: "Encargado",
  staff: "Personal",
  viewer: "Solo lectura",
} as const satisfies Record<MembershipRole, string>;

/** Human explanations aligned with current backend authority (not marketing). */
export const MEMBERSHIP_ROLE_DESCRIPTIONS = {
  owner:
    "Control total de la organización, incluida la gestión de todos los usuarios.",
  admin:
    "Gestiona gran parte de la organización, incluidos usuarios de menor nivel.",
  manager:
    "Gestiona pedidos, clientes, servicios, equipo operativo y actividad.",
  staff:
    "Trabaja con pedidos y clientes, sin acceso a configuración ni gestión de usuarios.",
  viewer:
    "Puede consultar información pero no realizar cambios operativos.",
} as const satisfies Record<MembershipRole, string>;

export const OPERATIVE_ROLES = [
  "owner",
  "admin",
  "manager",
  "staff",
] as const satisfies readonly MembershipRole[];

export const MANAGEMENT_ROLES = [
  "owner",
  "admin",
  "manager",
] as const satisfies readonly MembershipRole[];

export const ACCESS_ADMIN_ROLES = [
  "owner",
  "admin",
] as const satisfies readonly MembershipRole[];

export const INVITABLE_ROLES = [
  "admin",
  "manager",
  "staff",
  "viewer",
] as const satisfies readonly MembershipRole[];

export type InvitableRole = (typeof INVITABLE_ROLES)[number];

const ROLE_RANK: Record<MembershipRole, number> = {
  owner: 50,
  admin: 40,
  manager: 30,
  staff: 20,
  viewer: 10,
};

export function isMembershipRole(value: unknown): value is MembershipRole {
  return MEMBERSHIP_ROLES.includes(value as MembershipRole);
}

export function isInvitableRole(value: unknown): value is InvitableRole {
  return INVITABLE_ROLES.includes(value as InvitableRole);
}

export function hasMembershipRole<
  const Roles extends readonly MembershipRole[],
>(
  role: string | null | undefined,
  allowedRoles: Roles
): role is Roles[number] {
  return isMembershipRole(role) && allowedRoles.includes(role);
}

export function membershipRoleLabel(role: string | null | undefined) {
  if (isMembershipRole(role)) {
    return MEMBERSHIP_ROLE_LABELS[role];
  }
  return "Rol desconocido";
}

export function membershipRoleDescription(role: string | null | undefined) {
  if (isMembershipRole(role)) {
    return MEMBERSHIP_ROLE_DESCRIPTIONS[role];
  }
  return "";
}

export function membershipRoleRank(role: string | null | undefined) {
  if (!isMembershipRole(role)) {
    return 0;
  }
  return ROLE_RANK[role];
}

/** Mirrors public.actor_can_assign_membership_role (UI hint only). */
export function canAssignMembershipRole(
  actorRole: string | null | undefined,
  targetRole: string | null | undefined
) {
  if (!isMembershipRole(actorRole) || !isInvitableRole(targetRole)) {
    return false;
  }
  if (actorRole === "owner") {
    return true;
  }
  if (actorRole === "admin") {
    return (
      targetRole === "manager" ||
      targetRole === "staff" ||
      targetRole === "viewer"
    );
  }
  return false;
}

/** Mirrors public.actor_can_manage_membership_target (UI hint only). */
export function canManageMembershipTarget(
  actorRole: string | null | undefined,
  targetRole: string | null | undefined
) {
  if (!isMembershipRole(actorRole) || !isMembershipRole(targetRole)) {
    return false;
  }
  if (targetRole === "owner") {
    return false;
  }
  return canAssignMembershipRole(actorRole, targetRole);
}

export function invitableRolesForActor(
  actorRole: string | null | undefined
): InvitableRole[] {
  return INVITABLE_ROLES.filter((role) =>
    canAssignMembershipRole(actorRole, role)
  );
}

export function canManageTenantAccess(role: string | null | undefined) {
  return hasMembershipRole(role, ACCESS_ADMIN_ROLES);
}

export function canWriteOrders(role: string | null | undefined) {
  return hasMembershipRole(role, OPERATIVE_ROLES);
}

export function canWriteClients(role: string | null | undefined) {
  return hasMembershipRole(role, OPERATIVE_ROLES);
}

export function canWriteServices(role: string | null | undefined) {
  return hasMembershipRole(role, MANAGEMENT_ROLES);
}

export function canWriteTeam(role: string | null | undefined) {
  return hasMembershipRole(role, MANAGEMENT_ROLES);
}

export function canViewActivity(role: string | null | undefined) {
  return hasMembershipRole(role, MANAGEMENT_ROLES);
}
