/**
 * VAT rates offered by the order calculator (V1).
 *
 * Limited initial scope, not a full tax configuration: the four Spanish rates
 * as interface options. 0 % is just a rate; it does not mean an exemption.
 * Each saved line stores its own rate and amounts, so changing this list (or,
 * later, reading it from tenant settings or the central entitlements layer)
 * never changes historical amounts. A saved rate outside the list is still
 * shown and kept.
 */
export const ORDER_TAX_RATES = ["21", "10", "4", "0"] as const;

export const DEFAULT_ORDER_TAX_RATE = "21";

/** Rates for one select: the standard list plus `current` when it is not in it. */
export function taxRateOptions(current?: string | null): string[] {
  const options: string[] = [...ORDER_TAX_RATES];
  if (current && !options.includes(current)) options.push(current);
  return options;
}

export function taxRateLabel(rate: string): string {
  return `${rate.replace(".", ",")} %`;
}
