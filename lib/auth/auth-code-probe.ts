/**
 * Tells whether a PKCE `code` from an email link is real when the app cannot
 * exchange it for a session.
 *
 * Supabase Auth only hands out that `code` after `/auth/v1/verify` has
 * confirmed the email. The exchange still fails in two common cases:
 * - the link is opened in another browser or device, so there is no code
 *   verifier cookie (`pkce_code_verifier_not_found`, raised by the SDK before
 *   calling Supabase);
 * - the sign-up flow state has expired. It lasts 300 s from the sign-up, not
 *   from the click (`flow_state_expired`).
 *
 * To avoid showing success for a made-up code, the server asks Supabase Auth
 * with a verifier that can never match. In `supabase/auth`
 * (`internal/api/token.go`, PKCE grant):
 * - an unknown code returns `flow_state_not_found` (404);
 * - an expired flow state returns `flow_state_expired` (422);
 * - a real, live code returns `bad_code_verifier` (400). The flow state is
 *   left untouched: it is only deleted after a successful exchange.
 */

/** Supabase Auth error codes that prove the code is real, so the email is confirmed. */
export const CONFIRMED_CODE_ERROR_CODES: ReadonlySet<string> = new Set([
  "bad_code_verifier",
  "flow_state_expired",
]);

/** Raised by the Supabase SDK when there is no code verifier cookie. */
export const MISSING_CODE_VERIFIER = "pkce_code_verifier_not_found";

/**
 * Sent instead of the real verifier. Supabase compares its SHA-256 with the
 * challenge the SDK derived from a random verifier, so it never matches.
 */
export const PROBE_CODE_VERIFIER =
  "gestcopy-confirm-probe-never-matches-a-real-pkce-verifier";

const PROBE_TIMEOUT_MS = 5000;

/**
 * Supabase Auth issues `auth_code` as a UUID (`uuid.NewV4().String()` in
 * `models/flow_state.go`). Anything else cannot be real, so it is not sent:
 * `/token` shares one per-IP rate limit for `password`, `refresh_token` and
 * `pkce`, and these requests come from the app servers.
 */
const AUTH_CODE_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function looksLikeAuthCode(code: string): boolean {
  return AUTH_CODE_PATTERN.test(code);
}

/** Resolves to true only when Supabase Auth recognises the code. Never throws. */
export type AuthCodeProbe = (code: string) => Promise<boolean>;

/** Reads the error code from a Supabase Auth error body (old and new shapes). */
export function authErrorCode(body: unknown): string | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const record = body as Record<string, unknown>;
  if (typeof record.error_code === "string") {
    return record.error_code;
  }
  if (typeof record.code === "string") {
    return record.code;
  }
  return null;
}

export function createAuthCodeProbe(options: {
  supabaseUrl: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): AuthCodeProbe {
  const endpoint = `${options.supabaseUrl.replace(/\/+$/, "")}/auth/v1/token?grant_type=pkce`;
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? PROBE_TIMEOUT_MS;

  return async (code) => {
    if (!looksLikeAuthCode(code)) {
      return false;
    }

    try {
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          apikey: options.apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          auth_code: code,
          code_verifier: PROBE_CODE_VERIFIER,
        }),
        cache: "no-store",
        signal: AbortSignal.timeout(timeoutMs),
      });

      // A success would mean the dummy verifier matched, which cannot
      // happen. It proves nothing, so it does not count as confirmation.
      if (response.ok) {
        return false;
      }

      const errorCode = authErrorCode(await response.json().catch(() => null));
      return errorCode !== null && CONFIRMED_CODE_ERROR_CODES.has(errorCode);
    } catch {
      return false;
    }
  };
}
