export type InactiveTenantReason =
  | "pending_billing"
  | "administratively_disabled";

/**
 * Presentation-only reason from /tenant-inactive?reason=…
 * Defaults to administratively_disabled (no payment CTA) when unknown/missing.
 */
export function parseInactiveTenantReason(
  raw: string | null | undefined
): InactiveTenantReason {
  if (raw === "pending_billing") {
    return "pending_billing";
  }
  return "administratively_disabled";
}
