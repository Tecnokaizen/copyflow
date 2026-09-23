import { ACCESS_ADMIN_ROLES, hasMembershipRole } from "@/lib/auth/membership-roles";

/** Demo-only entry. Operational roles must not see the public Kiosk shortcut. */
export function canOpenKioskDemo(role: string | null | undefined) {
  return hasMembershipRole(role, ACCESS_ADMIN_ROLES);
}
