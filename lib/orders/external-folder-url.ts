/**
 * Normalize/validate orders.external_folder_url ("Enlace a Drive").
 * Complements Files/R2 — optional external folder link (http/https only).
 */

export const EXTERNAL_FOLDER_URL_MAX_LENGTH = 2048;

export type ExternalFolderUrlResult =
  | { ok: true; value: string | null }
  | { ok: false };

/**
 * null / blank → null.
 * Otherwise trim and require a real http(s) URL ≤ 2048 chars.
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

  if (trimmed.length > EXTERNAL_FOLDER_URL_MAX_LENGTH) {
    return { ok: false };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false };
  }

  return { ok: true, value: trimmed };
}
