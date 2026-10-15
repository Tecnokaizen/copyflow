import { NextResponse } from "next/server";

import { AUTH_RESPONSE_HEADERS } from "@/lib/supabase/session-cookies";
import { tenantDeniedFailure, type AccessFailure } from "@/lib/tenant/access";
import { logAccessFailure } from "@/lib/tenant/access-log";

export function accessFailureResponse(failure: AccessFailure, route: string) {
  const correlationId = crypto.randomUUID();
  logAccessFailure({
    route,
    status: failure.status,
    category: failure.category,
    tenantSlug: failure.tenantSlug,
    correlationId,
    at: new Date().toISOString(),
  });

  return NextResponse.json(
    {
      error: failure.error,
      code: failure.code,
      correlation_id: correlationId,
    },
    {
      status: failure.status,
      headers: {
        ...AUTH_RESPONSE_HEADERS,
        "X-Correlation-Id": correlationId,
      },
    }
  );
}

export function roleDeniedResponse(route: string, tenantSlug: string) {
  return accessFailureResponse(tenantDeniedFailure(tenantSlug), route);
}
