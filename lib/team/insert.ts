import type { TeamMemberPayload } from "@/lib/team/types";

export function buildTeamMemberInsert(
  sessionTenantId: string,
  payload: TeamMemberPayload
) {
  return {
    tenant_id: sessionTenantId,
    name: payload.name,
    job_title: payload.job_title,
    department: payload.department,
    email: payload.email,
    phone: payload.phone,
    active: payload.active,
    can_receive_orders: payload.can_receive_orders,
    user_id: payload.user_id,
  };
}
