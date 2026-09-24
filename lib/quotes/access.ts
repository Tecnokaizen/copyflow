import {
  OPERATIVE_ROLES,
  hasMembershipRole,
} from "@/lib/auth/membership-roles";

export const QUOTES_FEATURE_CODE = "quotes";

export function canAccessQuotesModule(
  role: string | null | undefined,
  featureEnabled: boolean
) {
  return featureEnabled && hasMembershipRole(role, OPERATIVE_ROLES);
}
