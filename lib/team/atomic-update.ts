import type { TeamMemberPayload } from "@/lib/team/types";
import type { LinkChangeResult } from "@/lib/team/link";

export type TeamMemberFormSnapshot = {
  name: string;
  job_title: string | null;
  department: string | null;
  email: string | null;
  phone: string | null;
  active: boolean;
  can_receive_orders: boolean;
  user_id: string | null;
};

export function applyAtomicTeamMemberPatch(
  current: TeamMemberFormSnapshot,
  patch: TeamMemberFormSnapshot,
  link: LinkChangeResult
):
  | { ok: true; next: TeamMemberFormSnapshot }
  | { ok: false; code: string; next: TeamMemberFormSnapshot } {
  if (!link.ok) {
    return { ok: false, code: link.code, next: { ...current } };
  }

  return {
    ok: true,
    next: {
      name: patch.name,
      job_title: patch.job_title,
      department: patch.department,
      email: patch.email,
      phone: patch.phone,
      active: patch.active,
      can_receive_orders: patch.can_receive_orders,
      user_id: link.userId,
    },
  };
}

export function updateTeamMemberRpcParams(input: {
  teamMemberId: string;
  tenantId: string;
  payload: TeamMemberPayload;
}) {
  return {
    p_team_member_id: input.teamMemberId,
    p_name: input.payload.name,
    p_job_title: input.payload.job_title,
    p_department: input.payload.department,
    p_email: input.payload.email,
    p_phone: input.payload.phone,
    p_active: input.payload.active,
    p_can_receive_orders: input.payload.can_receive_orders,
    p_user_id: input.payload.user_id,
    p_tenant_id: input.tenantId,
  };
}
