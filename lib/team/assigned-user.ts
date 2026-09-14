import type { TeamAccessUser } from "@/lib/team/link";

export function assignedGestcopyUser(
  member: { user_id: string | null },
  accessUsers: TeamAccessUser[]
) {
  if (!member.user_id) {
    return null;
  }

  return accessUsers.find((user) => user.user_id === member.user_id) ?? null;
}
