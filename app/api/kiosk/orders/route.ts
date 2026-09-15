import { handleKioskOrderRequest } from "@/lib/kiosk/http";
import { createKioskOrder } from "@/lib/kiosk/server";
import { resolveRequestTenantSlug } from "@/lib/tenant/request-host";

export async function POST(request: Request) {
  const tenantSlug = await resolveRequestTenantSlug();
  return handleKioskOrderRequest(request, tenantSlug, createKioskOrder);
}
