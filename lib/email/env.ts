import "server-only";

export type EmailTransportMode = "resend" | "console" | "fail";

function isNonProduction() {
  return process.env.NODE_ENV !== "production";
}

/**
 * Resolves transport. `console` / `fail` are explicit and non-production only.
 * Production never fakes success when Resend is misconfigured.
 */
export function resolveEmailTransport(): EmailTransportMode {
  const raw = (process.env.EMAIL_TRANSPORT ?? "").trim().toLowerCase();

  if (raw === "console" || raw === "fail") {
    if (!isNonProduction()) {
      return "resend";
    }
    return raw;
  }

  return "resend";
}

export function getResendApiKey() {
  const key = process.env.RESEND_API_KEY?.trim();
  return key || null;
}

export function getEmailFrom() {
  const from = process.env.EMAIL_FROM?.trim();
  return from || null;
}

export function assertEmailConfigForResend():
  | { ok: true; apiKey: string; from: string }
  | { ok: false; reason: "missing_api_key" | "missing_from" } {
  const apiKey = getResendApiKey();
  const from = getEmailFrom();

  if (!apiKey) {
    return { ok: false, reason: "missing_api_key" };
  }

  if (!from) {
    return { ok: false, reason: "missing_from" };
  }

  return { ok: true, apiKey, from };
}
