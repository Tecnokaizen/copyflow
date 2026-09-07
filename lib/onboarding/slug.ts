export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const RESERVED_SLUGS = new Set([
  "app",
  "www",
  "api",
  "admin",
  "auth",
  "dashboard",
  "demo",
]);

export const DEFAULT_TIMEZONE = "Europe/Madrid";

export function normalizeSlugInput(value: string) {
  return value
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-{2,}/g, "-");
}

export function finalizeSlug(value: string) {
  return normalizeSlugInput(value).replace(/^-+/, "").replace(/-+$/, "");
}

export function slugFromName(name: string) {
  return finalizeSlug(name);
}

export function getSlugIssue(slug: string) {
  if (!slug) {
    return "El identificador no puede estar vacío.";
  }

  if (!SLUG_PATTERN.test(slug)) {
    return "Usa solo minúsculas, números y guiones.";
  }

  if (RESERVED_SLUGS.has(slug)) {
    return "Ese identificador está reservado.";
  }

  return null;
}
