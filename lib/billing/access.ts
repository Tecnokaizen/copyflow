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

/** Plans with a Stripe price (20261028090000). */
export const BILLING_PLAN_CODES = ["basic", "pro"] as const;
export type BillingPlanCode = (typeof BILLING_PLAN_CODES)[number];

/**
 * Plans anyone can buy. Pro is sold only through an operator-granted tenant
 * billing offer while its committed features are missing (owner, 27/10/2026).
 */
export const SELF_SERVE_PLAN_CODES = ["basic"] as const;

export const BILLING_INTERVALS = ["month"] as const;
export type BillingIntervalAllowed = (typeof BILLING_INTERVALS)[number];

export function isBillingPlanCode(value: unknown): value is BillingPlanCode {
  return value === "basic" || value === "pro";
}

export function isSelfServePlanCode(value: unknown): boolean {
  return value === "basic";
}

export function isBillingInterval(
  value: unknown
): value is BillingIntervalAllowed {
  return value === "month";
}

/** Included Basic storage (5 GiB binary). */
export const BASIC_STORAGE_BYTES = 5_368_709_120;

/** Included Pro storage (50 GiB binary). */
export const PRO_STORAGE_BYTES = 53_687_091_200;
