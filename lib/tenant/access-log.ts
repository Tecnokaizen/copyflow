import type { AccessCategory } from "@/lib/tenant/access";

export type AccessLogInput = {
  route: string;
  status: number;
  category: AccessCategory;
  tenantSlug: string | null;
  correlationId: string;
  at: string;
};

/**
 * Safe diagnostic for an auth failure. Callers must not pass tokens,
 * cookies, passwords or Authorization headers: those fields are not accepted.
 */
export function accessLogRecord(input: AccessLogInput) {
  const record: Record<string, string | number> = {
    event: input.category,
    route: input.route,
    status: input.status,
    category: input.category,
    at: input.at,
    correlation_id: input.correlationId,
  };

  if (input.tenantSlug) {
    record.tenant = input.tenantSlug;
  }

  return record;
}

export function logAccessFailure(input: AccessLogInput) {
  console.error(JSON.stringify(accessLogRecord(input)));
}
