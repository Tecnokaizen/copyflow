import { SLUG_PATTERN } from "@/lib/onboarding/slug";

/** HttpOnly cookie used only in Preview / local development. */
export const PREVIEW_TENANT_COOKIE = "gc_preview_tenant";

/** Preferred query param. `slug` accepted as alias. */
export const PREVIEW_TENANT_QUERY = "tenant";

/**
 * Explicit tenant override is allowed only on Vercel Preview or local `next dev`.
 * Production (VERCEL_ENV=production) never accepts it.
 */
export function isTenantOverrideAllowed(): boolean {
  if (process.env.VERCEL_ENV === "production") {
    return false;
  }

  if (process.env.VERCEL_ENV === "preview") {
    return true;
  }

  return process.env.NODE_ENV === "development";
}

/** Validate a tenant slug for Preview override (does not block reserved product slugs like demo). */
export function parsePreviewTenantSlug(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") {
    return null;
  }

  const slug = raw.trim().toLowerCase();
  if (!slug || !SLUG_PATTERN.test(slug)) {
    return null;
  }

  return slug;
}
