/**
 * Normalize/validate orders.external_folder_url («Ubicación externa de
 * archivos»). Complements Files/R2: where the order files live outside
 * Gestcopy — a Drive/Dropbox URL, a network path, a relative path or a plain
 * reference. Same contract as change_order_content_v2
 * (20261104121000_order_external_location_text_v1.sql).
 */

export const EXTERNAL_FOLDER_URL_MAX_LENGTH = 2048;

export type ExternalFolderUrlResult =
  | { ok: true; value: string | null }
  | { ok: false };

// Control characters (multi-line or invisible values) and script-like schemes.
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const SCRIPT_SCHEME = /^(javascript|data|vbscript)\s*:/i;

/**
 * null / blank → null.
 * Otherwise trim; any single-line text ≤ 2048 chars that is not a
 * javascript:/data:/vbscript: URI.
 */
export function normalizeExternalFolderUrl(
  raw: unknown
): ExternalFolderUrlResult {
  if (raw == null) {
    return { ok: true, value: null };
  }

  if (typeof raw !== "string") {
    return { ok: false };
  }

  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: true, value: null };
  }

  if (
    trimmed.length > EXTERNAL_FOLDER_URL_MAX_LENGTH ||
    CONTROL_CHARACTERS.test(trimmed) ||
    SCRIPT_SCHEME.test(trimmed)
  ) {
    return { ok: false };
  }

  return { ok: true, value: trimmed };
}

/**
 * The value as a link target, only when it is a real http(s) URL with a host.
 * Network paths and plain references are shown as text, never as links.
 */
export function externalLocationHref(
  value: string | null | undefined
): string | null {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      parsed.hostname
    ) {
      return parsed.href;
    }
  } catch {
    return null;
  }
  return null;
}
