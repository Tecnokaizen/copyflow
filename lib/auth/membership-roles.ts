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
