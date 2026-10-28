import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  RECOVERY_FAILURES,
  RECOVERY_FAILURE_MESSAGES,
  authErrorMessage,
  confirmErrorMessage,
  parseRecoveryFailure,
  type AuthFormContext,
} from "./auth-messages";

const CONTEXTS: AuthFormContext[] = [
  "login",
  "sign_up",
  "forgot_password",
  "update_password",
];

/** English fragments from Supabase or the starter template. */
const ENGLISH =
  /\b(invalid|login|credentials|password|error|occurred|session|missing|expired|please|email link|failed)\b/i;

function authError(message: string, code?: string, extra: Record<string, unknown> = {}) {
  return Object.assign(new Error(message), { name: "AuthApiError", code, status: 400, ...extra });
}

describe("authErrorMessage", () => {
  it("translates the common Supabase errors by code", () => {
    assert.equal(
      authErrorMessage(authError("Invalid login credentials", "invalid_credentials"), "login"),
      "El correo o la contraseña no son correctos."
    );
    assert.match(
      authErrorMessage(authError("Email not confirmed", "email_not_confirmed"), "login"),
      /confirmado tu correo/
    );
    assert.equal(
      authErrorMessage(
        authError("New password should be different from the old password.", "same_password", { status: 422 }),
        "update_password"
      ),
      "La contraseña nueva debe ser distinta de la actual."
    );
    assert.match(
      authErrorMessage(authError("User already registered", "user_already_exists"), "sign_up"),
      /Ya existe una cuenta/
    );
  });

  it("keeps the minimum length of a weak password", () => {
    assert.equal(
      authErrorMessage(
        authError("Password should be at least 8 characters.", "weak_password", { name: "AuthWeakPasswordError", status: 422 }),
        "update_password"
      ),
      "La contraseña debe tener al menos 8 caracteres."
    );
  });

  it("keeps the wait time of the email rate limit", () => {
    assert.equal(
      authErrorMessage(
        authError("For security purposes, you can only request this after 42 seconds.", "over_email_send_rate_limit", { status: 429 }),
        "forgot_password"
      ),
      "Por seguridad, espera 42 segundos antes de volver a pedirlo."
    );
  });

  it("explains a missing recovery session instead of 'Auth session missing!'", () => {
    const missing = Object.assign(new Error("Auth session missing!"), {
      name: "AuthSessionMissingError",
      status: 400,
    });
    assert.match(authErrorMessage(missing, "update_password"), /Pide uno nuevo/);
  });

  it("falls back to the English text when there is no code", () => {
    assert.equal(
      authErrorMessage(new Error("Invalid login credentials"), "login"),
      "El correo o la contraseña no son correctos."
    );
  });

  it("reports network failures", () => {
    const offline = Object.assign(new Error("Failed to fetch"), {
      name: "AuthRetryableFetchError",
      status: 0,
    });
    assert.match(authErrorMessage(offline, "login"), /conexión/);
  });

  it("never shows unknown English text", () => {
    const unknown = [
      authError("Something unexpected happened upstream"),
      new Error("An error occurred"),
      "plain string failure",
      null,
      undefined,
      42,
      { message: "Database error saving new user", status: 500 },
    ];
    for (const context of CONTEXTS) {
      for (const error of unknown) {
        const message = authErrorMessage(error, context);
        assert.doesNotMatch(message, ENGLISH, `${context}: ${message}`);
        assert.ok(message.length > 0);
      }
    }
  });
});

describe("recovery failures", () => {
  it("has a Spanish message for every reason", () => {
    for (const reason of RECOVERY_FAILURES) {
      const message = RECOVERY_FAILURE_MESSAGES[reason];
      assert.ok(message, reason);
      assert.doesNotMatch(message, ENGLISH, reason);
    }
  });

  it("accepts only known reasons from the query", () => {
    assert.equal(parseRecoveryFailure("link_expired"), "link_expired");
    assert.equal(parseRecoveryFailure("link_other_browser"), "link_other_browser");
    assert.equal(parseRecoveryFailure("<script>"), null);
    assert.equal(parseRecoveryFailure("Llama al 600 000 000"), null);
    assert.equal(parseRecoveryFailure(undefined), null);
  });
});

describe("confirmErrorMessage (/auth/error)", () => {
  it("translates the errors /auth/confirm can send", () => {
    assert.match(confirmErrorMessage("Email link is invalid or has expired"), /caducado/);
    assert.match(confirmErrorMessage("otp_expired"), /caducado/);
    assert.match(confirmErrorMessage("No token hash or type"), /no es válido/);
    assert.match(confirmErrorMessage("No token hash, type or code"), /no es válido/);
    assert.match(confirmErrorMessage("Invalid confirmation type"), /no es válido/);
    assert.match(
      confirmErrorMessage("PKCE code verifier not found in storage."),
      /mismo navegador/
    );
  });

  it("never echoes the query text", () => {
    const injected = "Tu cuenta está bloqueada. Llama al 600 000 000";
    const message = confirmErrorMessage(injected);
    assert.ok(!message.includes("600 000 000"));
    assert.doesNotMatch(message, ENGLISH);
    assert.doesNotMatch(confirmErrorMessage(undefined), ENGLISH);
  });
});
