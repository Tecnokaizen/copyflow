export type StripeMode = "test" | "live";

function readEnv(name: string): string | null {
  const value = process.env[name]?.trim();
  return value || null;
}

/**
 * STRIPE_MODE is required for any billing resolution path that depends on
 * test vs live catalog rows. Does not require the secret key.
 */
export function getStripeMode(): StripeMode {
  const raw = (readEnv("STRIPE_MODE") ?? "").toLowerCase();

  if (raw === "test" || raw === "live") {
    return raw;
  }

  throw new Error("Missing or invalid STRIPE_MODE (expected test|live)");
}

export function stripeModeToLivemode(mode: StripeMode): boolean {
  return mode === "live";
}

export type StripeConfig =
  | {
      ok: true;
      secretKey: string;
      webhookSecret: string;
      mode: StripeMode;
    }
  | {
      ok: false;
      reason:
        | "missing_secret_key"
        | "missing_webhook_secret"
        | "missing_or_invalid_mode";
    };

export function assertStripeConfig(): StripeConfig {
  const secretKey = readEnv("STRIPE_SECRET_KEY");
  const webhookSecret = readEnv("STRIPE_WEBHOOK_SECRET");

  let mode: StripeMode;
  try {
    mode = getStripeMode();
  } catch {
    return { ok: false, reason: "missing_or_invalid_mode" };
  }

  if (!secretKey) {
    return { ok: false, reason: "missing_secret_key" };
  }

  if (!webhookSecret) {
    return { ok: false, reason: "missing_webhook_secret" };
  }

  return { ok: true, secretKey, webhookSecret, mode };
}
