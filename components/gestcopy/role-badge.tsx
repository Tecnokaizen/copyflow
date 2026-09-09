import { StatusBadge } from "@/components/gestcopy/status-badge";
import {
  membershipRoleLabel,
  type MembershipRole,
} from "@/lib/auth/membership-roles";

type RoleBadgeProps = {
  role: string;
};

export function RoleBadge({ role }: RoleBadgeProps) {
  const tone =
    role === "owner"
      ? "brand"
      : role === "admin"
        ? "brand"
        : role === "viewer"
          ? "neutral"
          : role === "manager"
            ? "warning"
            : "neutral";

  return (
    <StatusBadge tone={tone}>
      {membershipRoleLabel(role as MembershipRole)}
    </StatusBadge>
  );
}
