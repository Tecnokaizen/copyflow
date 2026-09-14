import {
  getSafeNextPath,
  isInvitationAcceptNext,
} from "@/lib/auth/safe-next-path";

export function shouldStayOnInvitationAccept(
  next: string | null | undefined
) {
  return isInvitationAcceptNext(next);
}

/**
 * While an invitation `next` is present it wins over onboarding or home.
 */
export function invitationFlowDestination(
  next: string | null | undefined,
  fallback = "/"
) {
  if (isInvitationAcceptNext(next)) {
    return getSafeNextPath(next);
  }

  return getSafeNextPath(next, fallback);
}
