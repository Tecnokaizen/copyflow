import { handleKioskOrderRequest } from "@/lib/kiosk/http";
import {
  createKioskRateLimiter,
  kioskClientKey,
} from "@/lib/kiosk/rate-limit";
import { createKioskOrder } from "@/lib/kiosk/server";
import { resolveRequestTenantSlug } from "@/lib/tenant/request-host";

const limiter = createKioskRateLimiter({
  limit: 5,
  windowMs: 60_000,
});

export async function POST(request: Request) {
  if (!limiter.allow(kioskClientKey(request))) {
    return Response.json(
      { error: "Demasiadas solicitudes. Inténtalo de nuevo en un minuto." },
      {
        status: 429,
        headers: {
          "Cache-Control": "no-store",
          "Retry-After": "60",
        },
      }
    );
  }
  const tenantSlug = await resolveRequestTenantSlug();
  return handleKioskOrderRequest(request, tenantSlug, createKioskOrder);
}
