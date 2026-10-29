import { canManageSettingsCatalogs, canWriteOrders } from "@/lib/auth/membership-roles";

// SUR4 E8: UI and route hints. The RPCs check the same roles again.

/** Steps: owner, admin, manager and staff (D5). Viewer only reads. */
export function canEditWorkSteps(role: string | null | undefined) {
  return canWriteOrders(role);
}

/** Stage catalog: owner, admin and manager. */
export function canManageWorkStages(role: string | null | undefined) {
  return canManageSettingsCatalogs(role);
}
