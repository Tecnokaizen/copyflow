import {
  isBillingInterval,
  isBillingPlanCode,
  isSelfServePlanCode,
  type BillingIntervalAllowed,
  type BillingPlanCode,
} from "@/lib/billing/access";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256_HEX = /^[0-9a-f]{64}$/;

export const OFFER_REQUIRED_CODE = "offer_required";

export type ParsedCheckoutRequest = {
  ok: true;
  planCode: BillingPlanCode;
  billingInterval: BillingIntervalAllowed;
  /** Present for an offer Checkout: the offer and the accepted terms hash. */
  offer: { offerId: string; termsHash: string } | null;
};

export function parseCheckoutRequest(
  body: unknown
): ParsedCheckoutRequest | { ok: false; error: string; code?: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "Invalid JSON body" };
  }

  const record = body as Record<string, unknown>;
  const allowed = new Set([
    "plan_code",
    "billing_interval",
    "offer_id",
    "terms_hash",
  ]);
  if (Object.keys(record).some((key) => !allowed.has(key))) {
    return { ok: false, error: "Unexpected fields" };
  }

  if ("tenant_id" in record) {
    return { ok: false, error: "tenant_id is not accepted" };
  }

  if (!isBillingPlanCode(record.plan_code)) {
    return { ok: false, error: "Invalid plan_code" };
  }

  if (!isBillingInterval(record.billing_interval)) {
    return { ok: false, error: "Invalid billing_interval" };
  }

  if (!("offer_id" in record) && !("terms_hash" in record)) {
    if (!isSelfServePlanCode(record.plan_code)) {
      return {
        ok: false,
        error: "This plan is only available with an offer",
        code: OFFER_REQUIRED_CODE,
      };
    }
    return {
      ok: true,
      planCode: record.plan_code,
      billingInterval: record.billing_interval,
      offer: null,
    };
  }

  if (typeof record.offer_id !== "string" || !UUID.test(record.offer_id)) {
    return { ok: false, error: "Invalid offer_id" };
  }
  if (
    typeof record.terms_hash !== "string" ||
    !SHA256_HEX.test(record.terms_hash)
  ) {
    return { ok: false, error: "Invalid terms_hash" };
  }

  return {
    ok: true,
    planCode: record.plan_code,
    billingInterval: record.billing_interval,
    offer: {
      offerId: record.offer_id.toLowerCase(),
      termsHash: record.terms_hash,
    },
  };
}
