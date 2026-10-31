import {
  authHrefWithNext,
  getPostAuthRedirectPath,
} from "@/lib/auth/safe-next-path";
import type { RecoveryFailure } from "@/lib/auth/auth-messages";

/**
 * `/auth/recovery` turns a password recovery email link into a session, then
 * sends the user to `/auth/update-password`. It accepts both link shapes:
 *
 * - `code`: the default Supabase template links to `/auth/v1/verify`, which
 *   returns here with a PKCE code. The browser client (`@supabase/ssr`) left
 *   the code verifier in a cookie when the user asked for the email, so only
 *   that browser can exchange it. Supabase also expires that flow 5 minutes
 *   after the request (`flow_state_expired`).
 * - `token_hash` + `type=recovery`: a custom template links straight here and
 *   the server verifies it. Works from any browser while the token is valid.
 *
 * Supabase can also come back with `error`, `error_code` and
 * `error_description` (for example, `otp_expired` for an old or used link).
 *
 * Any failure goes to `/auth/forgot-password?error=<reason>`, which explains
 * what happened in Spanish and lets the user ask for a new link. A failure
 * never reaches `next`.
 *
 * Why not `/auth/confirm`: on `main` it only accepts `token_hash`, and PR #161
 * (not merged) sends a recognised-but-unexchangeable `code` to "Correo
 * confirmado. Ya puedes iniciar sesión", which is wrong for a password reset.
 * A route of its own keeps recovery independent of #161 and only ever opens
 * a session to change the password.
 */

export const UPDATE_PASSWORD_PATH = "/auth/update-password";
export const FORGOT_PASSWORD_PATH = "/auth/forgot-password";

type AuthResult = { error: { message: string; code?: string } | null };

/** The two Supabase auth methods this callback needs. */
export type RecoveryAuthClient = {
  verifyOtp(params: { type: "recovery"; token_hash: string }): Promise<AuthResult>;
  exchangeCodeForSession(code: string): Promise<AuthResult>;
};

export type RecoveryCallbackRequest =
  | { kind: "token_hash"; tokenHash: string; next: string }
  | { kind: "code"; code: string; next: string }
  | { kind: "failure"; reason: RecoveryFailure; next: string };

function nonEmpty(value: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** Supabase error codes that mean the link is too old or already used. */
const EXPIRED_CODES = new Set(["otp_expired", "flow_state_expired"]);

/**
 * The code verifier is missing (another browser or device, or the link was
 * already used here) or belongs to a newer request from this browser.
 */
const OTHER_BROWSER_CODES = new Set([
  "pkce_code_verifier_not_found",
  "bad_code_verifier",
]);

export function recoveryFailureReason(error: {
  code?: string | null;
  message?: string | null;
}): RecoveryFailure {
  const code = error.code ?? "";
  if (EXPIRED_CODES.has(code)) return "link_expired";
  if (OTHER_BROWSER_CODES.has(code)) return "link_other_browser";

  const message = (error.message ?? "").toLowerCase();
  if (message.includes("code verifier")) return "link_other_browser";
  if (message.includes("expired")) return "link_expired";
  return "link_invalid";
}

export function parseRecoveryCallback(
  searchParams: URLSearchParams
): RecoveryCallbackRequest {
  const next = getPostAuthRedirectPath(searchParams.get("next"));
  const tokenHash = nonEmpty(searchParams.get("token_hash"));
  const type = nonEmpty(searchParams.get("type"));
  const code = nonEmpty(searchParams.get("code"));

  // An explicit token_hash link wins: it is what a custom template sends.
  if (tokenHash) {
    // This route only opens sessions to change a password.
    if (type !== "recovery") {
      return { kind: "failure", reason: "link_invalid", next };
    }
    return { kind: "token_hash", tokenHash, next };
  }

  if (code) {
    return { kind: "code", code, next };
  }

  const providerCode =
    nonEmpty(searchParams.get("error_code")) ??
    nonEmpty(searchParams.get("error"));
  const providerMessage = nonEmpty(searchParams.get("error_description"));
  if (providerCode || providerMessage) {
    return {
      kind: "failure",
      reason: recoveryFailureReason({
        code: providerCode,
        message: providerMessage,
      }),
      next,
    };
  }

  return { kind: "failure", reason: "link_invalid", next };
}

/** `/auth/forgot-password` with the reason and, when internal, `next`. */
export function recoveryFailurePath(
  reason: RecoveryFailure,
  next: string | null | undefined
): string {
  const url = new URL(
    authHrefWithNext(FORGOT_PASSWORD_PATH, getPostAuthRedirectPath(next)),
    "http://safe.local"
  );
  url.searchParams.set("error", reason);
  return `${url.pathname}${url.search}`;
}

export function updatePasswordPath(next: string | null | undefined): string {
  return authHrefWithNext(UPDATE_PASSWORD_PATH, getPostAuthRedirectPath(next));
}

function isNetworkFailure(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const { name, status } = error as { name?: unknown; status?: unknown };
  return name === "AuthRetryableFetchError" || name === "TypeError" || status === 0;
}

/**
 * Decides where `/auth/recovery` redirects. The auth client is created only
 * when there is a code or token to check.
 */
export async function resolveRecoveryRedirect(
  searchParams: URLSearchParams,
  getAuthClient: () => Promise<RecoveryAuthClient>
): Promise<string> {
  const request = parseRecoveryCallback(searchParams);

  if (request.kind === "failure") {
    return recoveryFailurePath(request.reason, request.next);
  }

  try {
    const auth = await getAuthClient();
    const { error } =
      request.kind === "token_hash"
        ? await auth.verifyOtp({ type: "recovery", token_hash: request.tokenHash })
        : await auth.exchangeCodeForSession(request.code);

    if (error) {
      return recoveryFailurePath(
        isNetworkFailure(error) ? "service_unavailable" : recoveryFailureReason(error),
        request.next
      );
    }
    return updatePasswordPath(request.next);
  } catch (error) {
    if (isNetworkFailure(error)) {
      return recoveryFailurePath("service_unavailable", request.next);
    }
    const shape = (error ?? {}) as { code?: string; message?: string };
    return recoveryFailurePath(
      recoveryFailureReason({ code: shape.code, message: shape.message }),
      request.next
    );
  }
}

/** Auth keys Supabase can put in the URL fragment, where the server cannot see them. */
const HASH_AUTH_PARAMS = [
  "error",
  "error_code",
  "error_description",
  "access_token",
  "refresh_token",
  "provider_token",
  "expires_at",
  "expires_in",
  "token_type",
  "type",
  "sb",
] as const;

export type HashRecoveryState = {
  /** Reason from `#error_code=...` (or `#error=`/`#error_description=`), if any. */
  failure: RecoveryFailure | null;
  /** True when the fragment carries auth data and should be removed from the URL. */
  shouldClear: boolean;
};

/**
 * Supabase also returns errors in the fragment (`#error_code=otp_expired&...`):
 * always for the implicit flow, and next to the query for PKCE. The 307 from
 * `/auth/recovery` keeps the fragment, so `/auth/forgot-password` reads it in
 * the browser to explain the failure, then removes it from the address bar.
 */
export function recoveryStateFromHash(hash: string): HashRecoveryState {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const shouldClear = HASH_AUTH_PARAMS.some((key) => params.has(key));

  const code = nonEmpty(params.get("error_code")) ?? nonEmpty(params.get("error"));
  const message = nonEmpty(params.get("error_description"));
  const failure =
    code || message ? recoveryFailureReason({ code, message }) : null;

  return { failure, shouldClear };
}

/** Query keys a recovery link can carry. */
const RECOVERY_LINK_PARAMS = [
  "code",
  "token_hash",
  "type",
  "error",
  "error_code",
  "error_description",
] as const;

/**
 * Emails sent before `/auth/recovery` existed link to `/auth/update-password`
 * with the code or the error. That page forwards them here so the server
 * handles them the same way. Returns null when there is nothing to forward.
 */
export function legacyRecoveryForwardPath(
  searchParams: URLSearchParams
): string | null {
  const forwarded = new URLSearchParams();
  for (const key of RECOVERY_LINK_PARAMS) {
    const value = searchParams.get(key);
    if (value !== null) forwarded.set(key, value);
  }
  if (![...forwarded.keys()].some((key) => key !== "type")) {
    return null;
  }
  forwarded.set("next", getPostAuthRedirectPath(searchParams.get("next")));
  return `/auth/recovery?${forwarded.toString()}`;
}
