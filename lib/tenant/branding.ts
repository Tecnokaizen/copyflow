export const LOGO_MAX_BYTES = 2 * 1024 * 1024;
export const BUSINESS_NAME_MAX_LENGTH = 120;
export const TENANT_LOGO_PATH = "/api/tenant/logo";

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export type PublicBrandColor = string | null;

export type StoredLogo = {
  storageKey: string;
  contentType: "image/png" | "image/jpeg" | "image/webp";
};

export function logoDeclaredSizeIsAllowed(size: number) {
  return Number.isFinite(size) && size > 0 && size <= LOGO_MAX_BYTES;
}

export function parseBusinessName(
  value: unknown
): { ok: true; value: string | null } | { ok: false } {
  if (value == null) return { ok: true, value: null };
  if (typeof value !== "string") return { ok: false };
  const trimmed = value.trim();
  if (trimmed.length > BUSINESS_NAME_MAX_LENGTH) return { ok: false };
  return { ok: true, value: trimmed || null };
}

export function displayBusinessName(input: {
  businessName?: string | null;
  tenantName?: string | null;
}): string {
  const business = input.businessName?.trim() ?? "";
  if (business) return business;
  return input.tenantName?.trim() ?? "";
}

export function monogramFromName(name: string): string {
  const words = name
    .trim()
    .split(/[\s._-]+/)
    .filter(Boolean);
  if (words.length === 0) return "GC";
  if (words.length === 1) {
    return words[0].slice(0, 2).toUpperCase();
  }
  return `${words[0][0] ?? ""}${words[words.length - 1][0] ?? ""}`.toUpperCase();
}

export function parseBrandColor(value: unknown): PublicBrandColor | undefined {
  if (value == null || value === "") return null;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!HEX_COLOR.test(trimmed)) return undefined;
  return trimmed.toLowerCase();
}

export function brandColorFromBranding(branding: unknown): PublicBrandColor {
  if (!branding || typeof branding !== "object" || Array.isArray(branding)) {
    return null;
  }
  const raw = (branding as Record<string, unknown>).brand_color;
  return parseBrandColor(raw) ?? null;
}

export function storedLogoFromBranding(branding: unknown): StoredLogo | null {
  if (!branding || typeof branding !== "object" || Array.isArray(branding)) {
    return null;
  }
  const logo = (branding as Record<string, unknown>).logo;
  if (!logo || typeof logo !== "object" || Array.isArray(logo)) return null;
  const record = logo as Record<string, unknown>;
  const storageKey =
    typeof record.storage_key === "string" ? record.storage_key : "";
  const contentType = record.content_type;
  if (
    contentType !== "image/png" &&
    contentType !== "image/jpeg" &&
    contentType !== "image/webp"
  ) {
    return null;
  }
  if (!storageKey) return null;
  return { storageKey, contentType };
}

export function publicOrganizationIdentity(input: {
  businessName?: string | null;
  tenantName?: string | null;
  branding: unknown;
}) {
  const logo = storedLogoFromBranding(input.branding);
  return {
    business_name: input.businessName?.trim() || null,
    display_name: displayBusinessName(input),
    logo_url: logo ? TENANT_LOGO_PATH : null,
    branding: {
      brand_color: brandColorFromBranding(input.branding),
    },
  };
}

export function identityPayloadExposesSecrets(value: unknown): boolean {
  const text = JSON.stringify(value);
  return (
    text.includes("storage_key") ||
    text.includes("R2_SECRET") ||
    text.includes("FILES_SIGNING_SECRET") ||
    text.includes("service_role")
  );
}

export function buildLogoStorageKey(tenantId: string, fileId: string): string {
  return `branding/${tenantId}/logo/${fileId}`;
}

export function logoKeyBelongsToTenant(storageKey: string, tenantId: string) {
  return storageKey.startsWith(`branding/${tenantId}/logo/`);
}

export function mergeBranding(
  current: unknown,
  patch: { brandColor?: PublicBrandColor; logo?: StoredLogo | null }
): Record<string, unknown> {
  const base =
    current && typeof current === "object" && !Array.isArray(current)
      ? { ...(current as Record<string, unknown>) }
      : {};
  if (patch.brandColor !== undefined) {
    if (patch.brandColor) base.brand_color = patch.brandColor;
    else delete base.brand_color;
  }
  if (patch.logo !== undefined) {
    if (patch.logo) {
      base.logo = {
        storage_key: patch.logo.storageKey,
        content_type: patch.logo.contentType,
      };
    } else {
      delete base.logo;
    }
  }
  return base;
}

function startsWith(bytes: Uint8Array, signature: number[]) {
  if (bytes.length < signature.length) return false;
  return signature.every((byte, index) => bytes[index] === byte);
}

export function sniffLogoContentType(
  bytes: Uint8Array
): StoredLogo["contentType"] | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return "image/png";
  }
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 12 &&
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

export function validateLogoBytes(bytes: Uint8Array):
  | { ok: true; contentType: StoredLogo["contentType"] }
  | { ok: false; error: string } {
  if (bytes.byteLength === 0 || bytes.byteLength > LOGO_MAX_BYTES) {
    return { ok: false, error: "Logo must be a PNG, JPEG, or WebP up to 2 MiB" };
  }
  const head = new TextDecoder().decode(bytes.slice(0, 256)).trimStart().toLowerCase();
  if (head.startsWith("<svg") || head.startsWith("<?xml") || head.includes("<svg")) {
    return { ok: false, error: "SVG logos are not supported" };
  }
  const contentType = sniffLogoContentType(bytes);
  if (!contentType) {
    return { ok: false, error: "Logo must be a PNG, JPEG, or WebP up to 2 MiB" };
  }
  return { ok: true, contentType };
}

function channel(hex: string, offset: number) {
  return Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
}

function luminance(hex: string) {
  const value = hex.slice(1);
  const parts = [0, 2, 4].map((offset) => {
    const raw = channel(value, offset);
    return raw <= 0.03928 ? raw / 12.92 : ((raw + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * parts[0] + 0.7152 * parts[1] + 0.0722 * parts[2];
}

export function brandColorAlpha(color: string, alpha: number): string | null {
  if (!HEX_COLOR.test(color)) return null;
  if (!Number.isFinite(alpha) || alpha < 0 || alpha > 1) return null;
  const value = color.slice(1);
  const red = Number.parseInt(value.slice(0, 2), 16);
  const green = Number.parseInt(value.slice(2, 4), 16);
  const blue = Number.parseInt(value.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

/** Active header item. Text stays on the foreground token; the brand color is only fill and a solid edge. */
export function activeNavAccent(brandColor: string | null): {
  className: string;
  style?: { backgroundColor: string; boxShadow: string };
} {
  const background = brandColor ? brandColorAlpha(brandColor, 0.1) : null;
  if (!brandColor || !background) {
    return { className: "bg-primary/10 text-primary" };
  }
  return {
    className: "text-foreground",
    style: {
      backgroundColor: background,
      boxShadow: `inset 0 -2px 0 ${brandColor}`,
    },
  };
}

/** Filled mark only when white text stays readable. Otherwise the color is a ring. */
export function brandMarkUsesFill(color: string | null): boolean {
  if (!color || !HEX_COLOR.test(color)) return false;
  const contrast = 1.05 / (luminance(color) + 0.05);
  return contrast >= 4.5;
}
