/**
 * Returns an internal relative path only.
 * Rejects protocol-relative URLs, absolute URLs, and scheme handlers.
 * Preserves safe query/hash when present.
 */
export function getSafeNextPath(
  raw: string | null | undefined,
  fallback = "/"
): string {
  if (typeof raw !== "string") {
    return fallback;
  }

  const trimmed = raw.trim();
  if (!trimmed) {
    return fallback;
  }

  if (!trimmed.startsWith("/")) {
    return fallback;
  }

  if (trimmed.startsWith("//")) {
    return fallback;
  }

  if (trimmed.includes("\\") || trimmed.includes("://")) {
    return fallback;
  }

  // Reject scheme handlers like javascript:, data:, etc. on the path itself.
  if (/^\/[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) {
    return fallback;
  }

  if (/[\u0000-\u001F\u007F]/.test(trimmed)) {
    return fallback;
  }

  try {
    const parsed = new URL(trimmed, "http://safe.local");
    if (parsed.origin !== "http://safe.local") {
      return fallback;
    }

    const path = `${parsed.pathname}${parsed.search}${parsed.hash}`;
    if (!path.startsWith("/") || path.startsWith("//")) {
      return fallback;
    }

    return path || fallback;
  } catch {
    return fallback;
  }
}

export function authHrefWithNext(
  authPath: string,
  next: string | null | undefined
): string {
  const base = authPath.startsWith("/") ? authPath : `/${authPath}`;

  if (typeof next !== "string" || !next.trim()) {
    return base;
  }

  const destination = getSafeNextPath(next);
  // Ignore unsafe values (fallback "/") and bare "/".
  if (destination === "/" && next.trim() !== "/") {
    return base;
  }
  if (destination === "/") {
    return base;
  }

  const url = new URL(base, "http://safe.local");
  url.searchParams.set("next", destination);
  return `${url.pathname}${url.search}`;
}

export function buildAuthConfirmUrl(
  origin: string,
  next: string | null | undefined
): string {
  const destination = getSafeNextPath(next);
  const url = new URL("/auth/confirm", origin);
  url.searchParams.set("next", destination);
  return url.toString();
}

const INVITATION_TOKEN_RE = /^[0-9a-f]{64}$/i;

/**
 * True when `next` is a safe invitation accept path with a hex token.
 * Used to allow tenant-host signup only as continuation of an invitation.
 */
export function isInvitationAcceptNext(
  next: string | null | undefined
): boolean {
  if (typeof next !== "string" || !next.trim()) {
    return false;
  }

  const safe = getSafeNextPath(next, "");
  if (!safe.startsWith("/invitations/accept")) {
    return false;
  }

  try {
    const parsed = new URL(safe, "http://safe.local");
    if (parsed.pathname !== "/invitations/accept") {
      return false;
    }
    const token = (parsed.searchParams.get("token") ?? "").trim();
    return INVITATION_TOKEN_RE.test(token);
  } catch {
    return false;
  }
}
