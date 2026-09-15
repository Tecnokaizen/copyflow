export const INVITATION_TOKEN_RE = /^[0-9a-f]{64}$/i;

export function parseInvitationToken(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const token = value.trim();
  if (!INVITATION_TOKEN_RE.test(token)) {
    return null;
  }

  return token;
}

export function invitationAcceptPath(token: string) {
  return `/invitations/accept?token=${encodeURIComponent(token)}`;
}
