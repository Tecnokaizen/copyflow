import type { MembershipRole } from "@/lib/auth/membership-roles";

/** Billing mutations (Checkout / Portal) are owner-only in V1. */
export function canManageBilling(role: string | null | undefined): boolean {
  return role === "owner";
}

export function assertOwnerRole(
  role: string | null | undefined
): role is MembershipRole {
  return canManageBilling(role);
}

export const BILLING_PLAN_CODES = ["basic"] as const;
export type BillingPlanCode = (typeof BILLING_PLAN_CODES)[number];

export const BILLING_INTERVALS = ["month"] as const;
export type BillingIntervalAllowed = (typeof BILLING_INTERVALS)[number];

export function isBillingPlanCode(value: unknown): value is BillingPlanCode {
  return value === "basic";
}

export function isBillingInterval(
  value: unknown
): value is BillingIntervalAllowed {
  return value === "month";
}

/** Included Basic storage (5 GiB binary). */
export const BASIC_STORAGE_BYTES = 5_368_709_120;
