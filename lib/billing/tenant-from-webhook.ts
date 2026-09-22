import { isUuid } from "@/lib/billing/stripe-status";

/**
 * Fail closed when multiple tenant identifiers disagree.
 * Never pick one arbitrarily.
 */
export function resolveTenantIdFromWebhookSources(input: {
  subscriptionTenantId?: string | null;
  sessionClientReferenceId?: string | null;
  sessionMetadataTenantId?: string | null;
}): { ok: true; tenantId: string } | { ok: false; errorCode: string } {
  const candidates = [
    input.subscriptionTenantId,
    input.sessionClientReferenceId,
    input.sessionMetadataTenantId,
  ]
    .map((v) => (typeof v === "string" ? v.trim() : ""))
    .filter(Boolean);

  if (candidates.length === 0) {
    return { ok: false, errorCode: "missing_tenant_id" };
  }

  const unique = [...new Set(candidates)];
  if (unique.length > 1) {
    return { ok: false, errorCode: "tenant_id_mismatch" };
  }

  const tenantId = unique[0];
  if (!isUuid(tenantId)) {
    return { ok: false, errorCode: "invalid_tenant_id" };
  }

  return { ok: true, tenantId };
}
