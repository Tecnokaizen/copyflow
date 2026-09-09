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

export function isMembershipRole(value: unknown): value is MembershipRole {
  return MEMBERSHIP_ROLES.includes(value as MembershipRole);
}

export function hasMembershipRole<
  const Roles extends readonly MembershipRole[],
>(
  role: string | null | undefined,
  allowedRoles: Roles
): role is Roles[number] {
  return isMembershipRole(role) && allowedRoles.includes(role);
}
