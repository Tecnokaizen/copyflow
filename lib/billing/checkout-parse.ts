import {
  isBillingInterval,
  isBillingPlanCode,
  type BillingIntervalAllowed,
  type BillingPlanCode,
} from "@/lib/billing/access";

export function parseCheckoutRequest(body: unknown):
  | {
      ok: true;
      planCode: BillingPlanCode;
      billingInterval: BillingIntervalAllowed;
    }
  | { ok: false; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "Invalid JSON body" };
  }

  const record = body as Record<string, unknown>;
  const allowed = new Set(["plan_code", "billing_interval"]);
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

  return {
    ok: true,
    planCode: record.plan_code,
    billingInterval: record.billing_interval,
  };
}
