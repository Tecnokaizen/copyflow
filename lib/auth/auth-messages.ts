/**
 * Spanish copy for the auth screens.
 *
 * Supabase Auth returns English messages. The UI never shows them: errors are
 * mapped by `code` first, then by the known English text (older servers and
 * SDK-side errors have no code), and anything else gets a generic message.
 */

export type AuthFormContext =
  | "login"
  | "sign_up"
  | "forgot_password"
  | "update_password";

export const PASSWORDS_DO_NOT_MATCH = "Las contraseñas no coinciden.";

const NETWORK =
  "No hay conexión con Gestcopy. Comprueba tu conexión a internet e inténtalo de nuevo.";
const SERVICE_UNAVAILABLE =
  "El servicio de acceso no responde ahora mismo. Inténtalo de nuevo en unos minutos.";
const TOO_MANY_REQUESTS =
  "Demasiados intentos seguidos. Espera unos minutos y vuelve a intentarlo.";
const TOO_MANY_EMAILS =
  "Hemos enviado demasiados correos en poco tiempo. Espera unos minutos y vuelve a intentarlo.";
const WEAK_PASSWORD =
  "La contraseña es demasiado débil. Usa una más larga que combine letras y números.";

const FALLBACK: Record<AuthFormContext, string> = {
  login: "No se ha podido iniciar sesión. Inténtalo de nuevo.",
  sign_up: "No se ha podido crear la cuenta. Inténtalo de nuevo.",
  forgot_password:
    "No se ha podido enviar el correo de recuperación. Inténtalo de nuevo.",
  update_password:
    "No se ha podido guardar la contraseña nueva. Inténtalo de nuevo.",
};

const SESSION_MISSING: Record<AuthFormContext, string> = {
  login: "Tu sesión ha caducado. Vuelve a iniciar sesión.",
  sign_up: "Tu sesión ha caducado. Vuelve a intentarlo.",
  forgot_password: "Tu sesión ha caducado. Vuelve a intentarlo.",
  update_password:
    "El enlace para cambiar la contraseña ya no es válido. Pide uno nuevo.",
};

type ErrorShape = {
  code: string | null;
  name: string | null;
  message: string | null;
  status: number | null;
};

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function errorShape(error: unknown): ErrorShape {
  if (typeof error === "string") {
    return { code: null, name: null, message: readString(error), status: null };
  }
  if (!error || typeof error !== "object") {
    return { code: null, name: null, message: null, status: null };
  }
  const record = error as Record<string, unknown>;
  return {
    code: readString(record.code),
    name: readString(record.name),
    message: readString(record.message),
    status: typeof record.status === "number" ? record.status : null,
  };
}

function minimumLength(message: string | null): number | null {
  const match = message?.match(/at least (\d+) characters/i);
  return match ? Number(match[1]) : null;
}

function waitSeconds(message: string | null): number | null {
  const match = message?.match(/after (\d+) seconds?/i);
  return match ? Number(match[1]) : null;
}

function weakPasswordMessage(message: string | null): string {
  const length = minimumLength(message);
  return length
    ? `La contraseña debe tener al menos ${length} caracteres.`
    : WEAK_PASSWORD;
}

function emailRateLimitMessage(message: string | null): string {
  const seconds = waitSeconds(message);
  return seconds
    ? `Por seguridad, espera ${seconds} segundos antes de volver a pedirlo.`
    : TOO_MANY_EMAILS;
}

function byCode(
  code: string,
  message: string | null,
  context: AuthFormContext
): string | null {
  switch (code) {
    case "invalid_credentials":
      return "El correo o la contraseña no son correctos.";
    case "email_not_confirmed":
      return "Todavía no has confirmado tu correo. Abre el enlace que te enviamos al crear la cuenta.";
    case "user_banned":
      return "Esta cuenta está bloqueada. Contacta con el administrador de tu organización.";
    case "user_already_exists":
    case "email_exists":
      return "Ya existe una cuenta con este correo. Inicia sesión o recupera la contraseña.";
    case "email_address_invalid":
      return "Revisa el correo electrónico: no es una dirección válida.";
    case "email_address_not_authorized":
      return "Ahora mismo no podemos enviar correos a esta dirección. Contacta con el soporte de Gestcopy.";
    case "signup_disabled":
    case "email_provider_disabled":
      return "El registro de cuentas no está disponible ahora mismo.";
    case "weak_password":
      return weakPasswordMessage(message);
    case "same_password":
      return "La contraseña nueva debe ser distinta de la actual.";
    case "over_email_send_rate_limit":
      return emailRateLimitMessage(message);
    case "over_request_rate_limit":
      return TOO_MANY_REQUESTS;
    case "captcha_failed":
      return "No hemos podido verificar la solicitud. Recarga la página e inténtalo de nuevo.";
    case "reauthentication_needed":
    case "reauthentication_not_valid":
      return "Por seguridad, vuelve a iniciar sesión antes de cambiar la contraseña.";
    case "session_not_found":
    case "session_expired":
    case "refresh_token_not_found":
    case "refresh_token_already_used":
    case "bad_jwt":
      return SESSION_MISSING[context];
    case "request_timeout":
    case "unexpected_failure":
    case "hook_timeout":
    case "hook_timeout_after_retry":
      return SERVICE_UNAVAILABLE;
    default:
      return null;
  }
}

function byMessage(
  message: string,
  context: AuthFormContext
): string | null {
  const text = message.toLowerCase();
  if (text.includes("invalid login credentials")) {
    return byCode("invalid_credentials", message, context);
  }
  if (text.includes("email not confirmed")) {
    return byCode("email_not_confirmed", message, context);
  }
  if (text.includes("user already registered")) {
    return byCode("user_already_exists", message, context);
  }
  if (text.includes("should be different from the old password")) {
    return byCode("same_password", message, context);
  }
  if (text.includes("password should be") || text.includes("weak password")) {
    return weakPasswordMessage(message);
  }
  if (text.includes("you can only request this after")) {
    return emailRateLimitMessage(message);
  }
  if (text.includes("rate limit")) {
    return TOO_MANY_REQUESTS;
  }
  if (text.includes("auth session missing")) {
    return SESSION_MISSING[context];
  }
  if (text.includes("failed to fetch") || text.includes("fetch failed")) {
    return NETWORK;
  }
  return null;
}

/** Spanish message for an error from a Supabase Auth call on an auth form. */
export function authErrorMessage(
  error: unknown,
  context: AuthFormContext
): string {
  const { code, name, message, status } = errorShape(error);

  if (code) {
    const mapped = byCode(code, message, context);
    if (mapped) return mapped;
  }
  if (name === "AuthSessionMissingError") {
    return SESSION_MISSING[context];
  }
  if (name === "AuthWeakPasswordError") {
    return weakPasswordMessage(message);
  }
  if (name === "AuthRetryableFetchError" || status === 0) {
    return NETWORK;
  }
  if (message) {
    const mapped = byMessage(message, context);
    if (mapped) return mapped;
  }
  if (status === 429) {
    return TOO_MANY_REQUESTS;
  }
  if (status !== null && status >= 500) {
    return SERVICE_UNAVAILABLE;
  }
  return FALLBACK[context];
}

/**
 * Why a password recovery link could not open a session. Sent as `?error=`
 * to `/auth/forgot-password`, which shows the message above the form.
 */
export const RECOVERY_FAILURES = [
  "link_expired",
  "link_other_browser",
  "link_invalid",
  "session_missing",
  "service_unavailable",
] as const;

export type RecoveryFailure = (typeof RECOVERY_FAILURES)[number];

export const RECOVERY_FAILURE_MESSAGES: Record<RecoveryFailure, string> = {
  link_expired:
    "El enlace para cambiar la contraseña ha caducado o ya se ha usado. Pide uno nuevo.",
  link_other_browser:
    "Este enlace solo funciona en el navegador y el dispositivo desde los que lo pediste. Ábrelo allí o pide uno nuevo desde aquí. Si ya cambiaste la contraseña con él, inicia sesión.",
  link_invalid:
    "El enlace para cambiar la contraseña no es válido o ya se ha usado. Pide uno nuevo.",
  session_missing:
    "Para elegir una contraseña nueva, abre el enlace que te enviamos por correo o pide uno nuevo.",
  service_unavailable:
    "No hemos podido comprobar el enlace ahora mismo. Vuelve a abrirlo en unos minutos o pide uno nuevo.",
};

export function parseRecoveryFailure(
  raw: string | null | undefined
): RecoveryFailure | null {
  return (RECOVERY_FAILURES as readonly string[]).includes(raw ?? "")
    ? (raw as RecoveryFailure)
    : null;
}

/**
 * Message for `/auth/error?error=...`. The query text comes from Supabase or
 * from `/auth/confirm`, and anyone can put text in a link, so it is never shown
 * as is: known errors get a Spanish message and the rest a generic one.
 */
export function confirmErrorMessage(raw: string | null | undefined): string {
  const text = (raw ?? "").toLowerCase();

  if (
    text.includes("otp_expired") ||
    text.includes("flow_state_expired") ||
    text.includes("has expired") ||
    text.includes("expired or is invalid")
  ) {
    return "El enlace ha caducado o ya se ha usado. Si tu cuenta ya está confirmada, inicia sesión; si no, vuelve a registrarte para recibir un enlace nuevo.";
  }
  if (
    text.includes("code verifier") ||
    text.includes("code_verifier") ||
    text.includes("bad_code_verifier")
  ) {
    return "Abre el enlace en el mismo navegador y dispositivo en el que creaste la cuenta. Si ya está confirmada, inicia sesión.";
  }
  if (
    text.includes("no token hash") ||
    text.includes("invalid confirmation type") ||
    text.includes("flow_state_not_found") ||
    text.includes("invalid flow state")
  ) {
    return "El enlace no es válido o está incompleto. Ábrelo de nuevo desde el correo, sin modificarlo.";
  }
  if (text.includes("access_denied")) {
    return "El enlace ya no es válido. Si tu cuenta ya está confirmada, inicia sesión.";
  }
  return "No hemos podido completar la verificación. El enlace puede haber caducado o ya se ha usado.";
}
