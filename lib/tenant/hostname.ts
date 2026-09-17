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

function previewBaseDomain() {
  if (process.env.VERCEL_ENV !== "preview") {
    return null;
  }

  const raw = process.env.TENANT_PREVIEW_BASE_DOMAIN?.trim();
  if (!raw) {
    return null;
  }

  return normalizeHostname(raw);
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
