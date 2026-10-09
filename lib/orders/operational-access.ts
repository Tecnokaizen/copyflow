import { isMembershipRole, canManageSettingsCatalogs } from "@/lib/auth/membership-roles";

/** An active membership is checked separately by getCurrentContext and RLS. */
export function canReadOperationalOverview(role: string | null | undefined) {
  return isMembershipRole(role);
}

export function canReadDashboardQuoteCounts(role: string | null | undefined) {
  return canManageSettingsCatalogs(role);
}
