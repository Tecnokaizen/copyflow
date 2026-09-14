import { isUuid } from "@/lib/access/payload";

export function parseResolvedInvitationAuthUserId(data: unknown): string | null {
  if (typeof data !== "string") {
    return null;
  }

  const id = data.trim();
  return isUuid(id) ? id : null;
}
