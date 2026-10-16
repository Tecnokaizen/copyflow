import { SLUG_PATTERN } from "../onboarding/slug";
import { TENANT_BASE_DOMAIN } from "./domains";

export function normalizeHostname(hostname: string) {
  return hostname
    .toLowerCase()
    .split(":")[0]
    .replace(/\.$/, "");
}

function slugFromBaseDomain(host: string, baseDomain: string) {
  if (host === baseDomain) {
    return { matched: true as const, slug: null };
  }

  const suffix = `.${baseDomain}`;

  if (!host.endsWith(suffix)) {
    return { matched: false as const, slug: null };
  }

  const slug = host.slice(0, -suffix.length);

  if (!slug || slug === "app" || slug.includes(".")) {
    return { matched: true as const, slug: null };
  }

  return { matched: true as const, slug };
}

export type HostnameEnv = {
  VERCEL_ENV?: string;
  TENANT_PREVIEW_BASE_DOMAIN?: string;
};

function previewBaseDomain(env: HostnameEnv = process.env as HostnameEnv) {
  if (env.VERCEL_ENV !== "preview") {
    return null;
  }

  const raw = env.TENANT_PREVIEW_BASE_DOMAIN?.trim();
  if (!raw) {
    return null;
  }

  return normalizeHostname(raw);
}

export type AuthorizedHostname =
  | { kind: "app" }
  | { kind: "tenant"; slug: string };

/**
 * Strict allow-list check. Unlike `getSubdomainFromHostname` (where "no slug"
 * can mean "app host" OR "unknown host"), this returns null for every hostname
 * that is not explicitly authorized, so callers can fail closed.
 *
 * Authorized hosts:
 * - `{app base}` → app, `{slug}.{app base}` → tenant (single label, SLUG_PATTERN)
 * - Preview only (VERCEL_ENV=preview + TENANT_PREVIEW_BASE_DOMAIN): same shape
 *   under the preview base domain.
 * - Local development only (`allowLocal`): localhost / 127.0.0.1 → app,
 *   `{slug}.localhost` → tenant.
 *
 * Nested labels, reserved `app.` prefixes, custom/unknown domains and invalid
 * slugs are NOT authorized.
 */
export function authorizeHostname(
  hostname: string,
  env: HostnameEnv,
  options: { allowLocal: boolean }
): AuthorizedHostname | null {
  const host = normalizeHostname(hostname);
  if (!host) {
    return null;
  }

  if (options.allowLocal && (host === "localhost" || host === "127.0.0.1")) {
    return { kind: "app" };
  }

  // Preview base is longer/more specific than production; evaluate it first.
  const bases: string[] = [];
  const preview = previewBaseDomain(env);
  if (preview) {
    bases.push(preview);
  }
  bases.push(TENANT_BASE_DOMAIN);
  if (options.allowLocal) {
    bases.push("localhost");
  }

  for (const base of bases) {
    const result = slugFromBaseDomain(host, base);
    if (!result.matched) {
      continue;
    }
    if (result.slug) {
      return SLUG_PATTERN.test(result.slug)
        ? { kind: "tenant", slug: result.slug }
        : null;
    }
    return host === base ? { kind: "app" } : null;
  }

  return null;
}

export function getSubdomainFromHostname(hostname: string) {
  const host = normalizeHostname(hostname);

  if (host === "localhost" || host === "127.0.0.1") {
    return null;
  }

  // Preview base is longer/more specific than production
  // (`demo.preview.app.gestcopy.com` also ends with `.app.gestcopy.com`).
  // Evaluate it first so nested production-suffix matches do not win.
  const previewBase = previewBaseDomain();
  if (previewBase) {
    const preview = slugFromBaseDomain(host, previewBase);
    if (preview.matched) {
      return preview.slug;
    }
  }

  const primary = slugFromBaseDomain(host, TENANT_BASE_DOMAIN);

  if (primary.matched) {
    return primary.slug;
  }

  // Local-only: {slug}.localhost (never in production).
  if (process.env.NODE_ENV !== "production") {
    const local = slugFromBaseDomain(host, "localhost");
    if (local.matched) {
      return local.slug;
    }
  }

  return null;
}
