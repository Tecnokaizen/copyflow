import type { EmailOtpType } from "@supabase/supabase-js";
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

export type ConfirmCallbackRequest =
  | { kind: "token_hash"; tokenHash: string; type: EmailOtpType; next: string }
  | { kind: "code"; code: string; next: string }
  | { kind: "error"; message: string };

type AuthResult = { error: { message: string } | null };

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

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "Could not confirm the email link";
}

/**
 * Returns where `/auth/confirm` should redirect. The auth client is created
 * only when there is something to verify or exchange.
 */
export async function resolveConfirmRedirect(
  searchParams: URLSearchParams,
  getAuthClient: () => Promise<ConfirmAuthClient>
): Promise<string> {
  const request = parseConfirmCallback(searchParams);

  if (request.kind === "error") {
    return confirmErrorPath(request.message);
  }

  try {
    const auth = await getAuthClient();
    const { error } =
      request.kind === "token_hash"
        ? await auth.verifyOtp({
            type: request.type,
            token_hash: request.tokenHash,
          })
        : await auth.exchangeCodeForSession(request.code);

    return error ? confirmErrorPath(error.message) : request.next;
  } catch (error) {
    return confirmErrorPath(errorMessage(error));
  }
}
