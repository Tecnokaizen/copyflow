/**
 * Pure helpers for Stripe Test/Live fail-closed checks (webhook + object).
 */

export function eventLivemodeMatchesExpected(
  eventLivemode: boolean,
  expectedLivemode: boolean
): boolean {
  return eventLivemode === expectedLivemode;
}

/**
 * When an object exposes livemode, it must match the enclosing event.
 * Objects without livemode skip this check.
 */
export function objectLivemodeMatchesEvent(
  objectLivemode: boolean | null | undefined,
  eventLivemode: boolean
): boolean {
  if (objectLivemode === null || objectLivemode === undefined) {
    return true;
  }
  return objectLivemode === eventLivemode;
}
