import { SLUG_PATTERN } from "@/lib/onboarding/slug";
import { isLocalDevHostname, tenantOrigin } from "@/lib/tenant/domains";
import { PRODUCTION_APP_ORIGIN } from "@/lib/tenant/trusted-origin";

export type EntryPageLocation = {
  origin: string;
  protocol: string;
  hostname: string;
  port?: string;
};

/**
 * Browser-side check of the entry URL the status endpoint returns, before the
 * onboarding success page navigates to it. The server builds the URL from its
 * own configuration; this only accepts the one shape that fits where the page
 * is running, compared as an exact string:
 * - Production app (`https://app.gestcopy.com`): `https://{slug}.app.gestcopy.com/auth/login`.
 * - Local development (localhost, 127.0.0.1, *.localhost): `{protocol}//{slug}.localhost[:port]/auth/login`.
 * - Any other origin (Vercel Preview / Staging): the same origin plus `/?tenant={slug}`.
 *   A page outside Production therefore never navigates to a Production host.
 * Anything else (other host or tenant, protocol, path, credentials, extra
 * parameters, fragments) returns null and the page does not redirect.
 */
export function safeOnboardingEntryUrl(
  raw: unknown,
  slug: unknown,
  location: EntryPageLocation
): string | null {
  if (typeof raw !== "string" || typeof slug !== "string") return null;
  if (!SLUG_PATTERN.test(slug) || slug.length > 63) return null;

  let expected: string;
  if (location.origin === PRODUCTION_APP_ORIGIN) {
    expected = `${tenantOrigin(slug)}/auth/login`;
  } else if (isLocalDevHostname(location.hostname)) {
    const port = location.port ? `:${location.port}` : "";
    expected = `${location.protocol}//${slug}.localhost${port}/auth/login`;
  } else {
    expected = `${location.origin}/?tenant=${encodeURIComponent(slug)}`;
  }

  return raw === expected ? expected : null;
}
