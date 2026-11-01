import type { EmailOtpType } from "@supabase/supabase-js";
import {
  CONFIRMED_CODE_ERROR_CODES,
  MISSING_CODE_VERIFIER,
  type AuthCodeProbe,
} from "@/lib/auth/auth-code-probe";
import { getSafeNextPath } from "@/lib/auth/safe-next-path";

/**
 * `/auth/confirm` receives the user back from a Supabase email link in one of
 * two shapes:
 *
 * - `token_hash` + `type`: the email template links straight to the app, which
 *   verifies the token with `verifyOtp`.
 * - `code`: the default template links to Supabase's `/auth/v1/verify`, which
 *   confirms the email and returns here with a PKCE code. The browser client
 *   (`@supabase/ssr`) starts sign-up with PKCE, and its code verifier cookie
 *   lets the server exchange that code for a session.
 *
 * Supabase can also return `error`, `error_code` and `error_description`
 * (for example, when a link has already been used).
 *
 * If Supabase confirmed the email but the code cannot become a session (another
 * device, or the flow state expired), the user goes to `/auth/confirmed`
 * ("Correo confirmado. Ya puedes iniciar sesión"). That only happens when
 * Supabase Auth recognises the code (see `auth-code-probe.ts`), and the page
 * needs the short-lived `CONFIRMED_COOKIE` that the route sets in that case.
 */

export const EMAIL_OTP_TYPES: readonly EmailOtpType[] = [
  "signup",
  "invite",
  "magiclink",
  "recovery",
  "email_change",
  "email",
];

export const MISSING_CONFIRM_PARAMS = "No token hash, type or code";
export const INVALID_CONFIRM_TYPE = "Invalid confirmation type";
export const CONFIRMED_PATH = "/auth/confirmed";

/**
 * Set by `/auth/confirm` only when Supabase Auth recognised the code. Without
 * it, `/auth/confirmed` sends the visitor to the login page, so the success
 * text is never shown for a link opened directly or shared.
 */
export const CONFIRMED_COOKIE = "gestcopy-email-confirmed";
export const CONFIRMED_COOKIE_MAX_AGE_SECONDS = 300;

export function confirmedCookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: CONFIRMED_PATH,
    secure,
    maxAge: CONFIRMED_COOKIE_MAX_AGE_SECONDS,
  };
}

export type ConfirmCallbackRequest =
  | { kind: "token_hash"; tokenHash: string; type: EmailOtpType; next: string }
  | { kind: "code"; code: string; next: string }
  | { kind: "error"; message: string };

/** `code` is the Supabase error code, when there is one. */
type AuthResult = { error: { message: string; code?: string } | null };

/** The two Supabase auth methods this callback needs. */
export type ConfirmAuthClient = {
  verifyOtp(params: {
    type: EmailOtpType;
    token_hash: string;
  }): Promise<AuthResult>;
  exchangeCodeForSession(code: string): Promise<AuthResult>;
};

function isEmailOtpType(value: string): value is EmailOtpType {
  return (EMAIL_OTP_TYPES as readonly string[]).includes(value);
}

function nonEmpty(value: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function parseConfirmCallback(
  searchParams: URLSearchParams
): ConfirmCallbackRequest {
  const next = getSafeNextPath(searchParams.get("next"));
  const tokenHash = nonEmpty(searchParams.get("token_hash"));
  const type = nonEmpty(searchParams.get("type"));
  const code = nonEmpty(searchParams.get("code"));

  // An explicit token_hash link wins: it is what a custom template sends.
  if (tokenHash && type) {
    if (!isEmailOtpType(type)) {
      return { kind: "error", message: INVALID_CONFIRM_TYPE };
    }
    return { kind: "token_hash", tokenHash, type, next };
  }

  if (code) {
    return { kind: "code", code, next };
  }

  const providerError =
    nonEmpty(searchParams.get("error_description")) ??
    nonEmpty(searchParams.get("error_code")) ??
    nonEmpty(searchParams.get("error"));
  if (providerError) {
    return { kind: "error", message: providerError };
  }

  return { kind: "error", message: MISSING_CONFIRM_PARAMS };
}

export function confirmErrorPath(message: string): string {
  return `/auth/error?error=${encodeURIComponent(message)}`;
}

/** "Email confirmed, sign in" page; keeps where to go after signing in. */
export function confirmedPath(next: string): string {
  return `${CONFIRMED_PATH}?next=${encodeURIComponent(getSafeNextPath(next))}`;
}

/** Login link on the confirmed page; `next` is only kept when it is internal. */
export function confirmedLoginPath(next: string | null | undefined): string {
  const safeNext = getSafeNextPath(next);
  return safeNext === "/"
    ? "/auth/login"
    : `/auth/login?next=${encodeURIComponent(safeNext)}`;
}

/**
 * True when the exchange failed but Supabase Auth shows the code is real, so
 * the email is confirmed and only the session is missing.
 */
async function confirmedWithoutSession(
  error: { code?: string },
  code: string,
  probeAuthCode: AuthCodeProbe | undefined
): Promise<boolean> {
  if (error.code && CONFIRMED_CODE_ERROR_CODES.has(error.code)) {
    return true;
  }
  if (error.code === MISSING_CODE_VERIFIER && probeAuthCode) {
    return probeAuthCode(code);
  }
  return false;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "Could not confirm the email link";
}

export type ConfirmOutcome = {
  destination: string;
  /** True only when Supabase Auth recognised the code; the route then sets `CONFIRMED_COOKIE`. */
  emailConfirmedWithoutSession: boolean;
};

function goTo(destination: string): ConfirmOutcome {
  return { destination, emailConfirmedWithoutSession: false };
}

/**
 * Decides where `/auth/confirm` should redirect. The auth client is created
 * only when there is something to verify or exchange. Without
 * `probeAuthCode`, a missing code verifier goes to the error page.
 */
export async function resolveConfirmOutcome(
  searchParams: URLSearchParams,
  getAuthClient: () => Promise<ConfirmAuthClient>,
  probeAuthCode?: AuthCodeProbe
): Promise<ConfirmOutcome> {
  const request = parseConfirmCallback(searchParams);

  if (request.kind === "error") {
    return goTo(confirmErrorPath(request.message));
  }

  try {
    const auth = await getAuthClient();

    if (request.kind === "token_hash") {
      const { error } = await auth.verifyOtp({
        type: request.type,
        token_hash: request.tokenHash,
      });
      return goTo(error ? confirmErrorPath(error.message) : request.next);
    }

    const { error } = await auth.exchangeCodeForSession(request.code);
    if (!error) {
      return goTo(request.next);
    }
    if (await confirmedWithoutSession(error, request.code, probeAuthCode)) {
      return {
        destination: confirmedPath(request.next),
        emailConfirmedWithoutSession: true,
      };
    }
    return goTo(confirmErrorPath(error.message));
  } catch (error) {
    return goTo(confirmErrorPath(errorMessage(error)));
  }
}

/** Same as `resolveConfirmOutcome`, returning only the destination. */
export async function resolveConfirmRedirect(
  searchParams: URLSearchParams,
  getAuthClient: () => Promise<ConfirmAuthClient>,
  probeAuthCode?: AuthCodeProbe
): Promise<string> {
  return (await resolveConfirmOutcome(searchParams, getAuthClient, probeAuthCode))
    .destination;
}
