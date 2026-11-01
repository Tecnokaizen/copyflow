/** Polling rules for /onboarding/success (GET /api/onboarding/status). */
export const STATUS_POLL_MAX_ATTEMPTS = 24;
export const STATUS_POLL_INTERVAL_MS = 2500;

export type OnboardingServerState =
  | "awaiting_payment"
  | "processing"
  | "active"
  | "failed"
  | "disabled";

export type OnboardingSuccessView =
  | OnboardingServerState
  /** 401: the session ended while waiting. */
  | "unauthenticated"
  /** 403: signed in with an account that does not own this checkout's organization. */
  | "forbidden"
  /** Other 4xx: the checkout session is not recognized. */
  | "invalid"
  /** No final answer after the last attempt. */
  | "timeout";

const SERVER_STATES: readonly string[] = [
  "awaiting_payment",
  "processing",
  "active",
  "failed",
  "disabled",
];
const FINAL_SERVER_STATES: readonly string[] = ["active", "failed", "disabled"];
// 4xx worth asking again: the server may answer differently in a moment.
const RETRYABLE_CLIENT_ERRORS = new Set([408, 409, 425, 429]);

export type OnboardingPollStep = {
  /** What the page shows next; null keeps the current view. */
  view: OnboardingSuccessView | null;
  pollAgain: boolean;
};

/**
 * One status response → what the page shows and whether to poll again.
 * `httpStatus` is null when the request itself failed.
 * Errors are never hidden: a non-retryable error stops at once, and the last
 * attempt always ends on a visible state instead of «Confirmando…».
 */
export function nextOnboardingPollStep(input: {
  httpStatus: number | null;
  bodyState?: unknown;
  attempt: number;
}): OnboardingPollStep {
  const last = input.attempt >= STATUS_POLL_MAX_ATTEMPTS;
  const status = input.httpStatus;

  if (status !== null && status >= 200 && status < 300) {
    const state =
      typeof input.bodyState === "string" && SERVER_STATES.includes(input.bodyState)
        ? (input.bodyState as OnboardingServerState)
        : null;
    if (state && FINAL_SERVER_STATES.includes(state)) {
      return { view: state, pollAgain: false };
    }
    // The pending-payment card already offers to continue the payment.
    if (state === "awaiting_payment") return { view: state, pollAgain: !last };
    if (last) return { view: "timeout", pollAgain: false };
    return { view: state, pollAgain: true };
  }

  if (status === 401) return { view: "unauthenticated", pollAgain: false };
  if (status === 403) return { view: "forbidden", pollAgain: false };
  if (
    status !== null &&
    status >= 400 &&
    status < 500 &&
    !RETRYABLE_CLIENT_ERRORS.has(status)
  ) {
    return { view: "invalid", pollAgain: false };
  }

  // Network failure, 5xx or a retryable 4xx.
  return last ? { view: "timeout", pollAgain: false } : { view: null, pollAgain: true };
}
