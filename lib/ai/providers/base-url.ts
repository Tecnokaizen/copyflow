/**
 * OpenAI endpoints the voice provider may call (G2 audit, M1). Audio and
 * transcripts must never reach a proxy or another host through a config
 * mistake, so any other AI_PROVIDER_BASE_URL makes the provider unavailable.
 * Unset keeps the default endpoint: the region (EU or not) is still an owner
 * decision (G2, B2).
 */
export const OPENAI_DEFAULT_BASE_URL = "https://api.openai.com/v1";

export const OPENAI_ALLOWED_BASE_URLS: ReadonlySet<string> = new Set([
  OPENAI_DEFAULT_BASE_URL,
  "https://eu.api.openai.com/v1",
]);

/**
 * Base URL without its trailing slash, or null when the value is not on the
 * allowlist. Exact match only: no other scheme, port, path, case or userinfo.
 */
export function resolveOpenAiBaseUrl(value: string | undefined): string | null {
  const raw = value?.trim() ?? "";
  if (!raw) {
    return OPENAI_DEFAULT_BASE_URL;
  }
  const normalized = raw.endsWith("/") ? raw.slice(0, -1) : raw;
  return OPENAI_ALLOWED_BASE_URLS.has(normalized) ? normalized : null;
}
