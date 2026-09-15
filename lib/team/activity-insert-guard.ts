const MANAGEMENT_ROLES = new Set(["owner", "admin", "manager"]);

export type TeamMemberInsertActor = {
  id: string | null;
  tenantId: string | null;
  role: string | null;
  membershipActive: boolean;
  pendingSelfInvitation: boolean;
};

/**
 * Mirrors the INSERT gate of public.tg_activity_log_team_member().
 * RLS team_members_insert_management stays owner/admin/manager only.
 */
export function canRecordTeamMemberCreated(input: {
  actor: TeamMemberInsertActor;
  row: { tenantId: string; userId: string | null };
}): boolean {
  const actorId = input.actor.id;
  if (!actorId) {
    return false;
  }

  if (
    input.actor.membershipActive &&
    input.actor.tenantId === input.row.tenantId &&
    input.actor.role !== null &&
    MANAGEMENT_ROLES.has(input.actor.role)
  ) {
    return true;
  }

  return (
    input.row.userId === actorId &&
    input.actor.membershipActive &&
    input.actor.tenantId === input.row.tenantId &&
    input.actor.pendingSelfInvitation
  );
}
