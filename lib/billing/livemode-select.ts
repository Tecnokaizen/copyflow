/**
 * Pure helpers for selecting Stripe rows by configured livemode.
 */

export function pickStripeCustomerIdForLivemode(
  rows: Array<{
    provider_customer_id: string | null;
    livemode: boolean;
  }>,
  livemode: boolean
): string | null {
  for (const row of rows) {
    if (row.livemode !== livemode) {
      continue;
    }
    const id = row.provider_customer_id;
    if (typeof id === "string" && id.trim().length > 0) {
      return id.trim();
    }
  }
  return null;
}

export function hasCurrentStripeSubscriptionForLivemode(
  rows: Array<{ status: string | null; livemode: boolean }>,
  livemode: boolean,
  currentStatuses: ReadonlySet<string> | readonly string[]
): boolean {
  const allowed =
    currentStatuses instanceof Set
      ? currentStatuses
      : new Set(currentStatuses);

  return rows.some(
    (row) =>
      row.livemode === livemode &&
      typeof row.status === "string" &&
      allowed.has(row.status)
  );
}

/**
 * Billing display selection:
 * 1) Stripe current for expected livemode wins
 * 2) else non-Stripe current (internal/MVP)
 * Never returns Stripe of the opposite mode.
 */
export function pickBillingDisplaySubscription<
  T extends {
    provider: string | null;
    livemode: boolean;
    status: string;
  },
>(
  candidates: T[],
  expectedLivemode: boolean,
  currentStatuses: ReadonlySet<string> | readonly string[]
): T | null {
  const allowed =
    currentStatuses instanceof Set
      ? currentStatuses
      : new Set(currentStatuses);

  const current = candidates.filter((row) => allowed.has(row.status));

  const stripeForMode = current.find(
    (row) => row.provider === "stripe" && row.livemode === expectedLivemode
  );
  if (stripeForMode) {
    return stripeForMode;
  }

  return current.find((row) => row.provider !== "stripe") ?? null;
}

/** Onboarding status: session livemode must match runtime mode. */
export function onboardingSessionLivemodeMatches(
  sessionLivemode: boolean,
  expectedLivemode: boolean
): boolean {
  return sessionLivemode === expectedLivemode;
}

/** Attempt correlation is fail-closed when livemode differs. */
export function onboardingAttemptMatchesLivemode(
  attempt: { livemode: boolean } | null | undefined,
  expectedLivemode: boolean
): boolean {
  return Boolean(attempt) && attempt!.livemode === expectedLivemode;
}
