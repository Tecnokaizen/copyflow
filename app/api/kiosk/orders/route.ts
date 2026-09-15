import { handleKioskOrderRequest } from "@/lib/kiosk/http";
import { createKioskOrder } from "@/lib/kiosk/server";
import { trustedKioskRequestContext } from "@/lib/kiosk/trusted-request";

export async function POST(request: Request) {
  const context = trustedKioskRequestContext(request.headers, process.env);
  return handleKioskOrderRequest(request, context, createKioskOrder);
}
