import {
  admitKioskHttpRequest,
  handleKioskOrderRequest,
} from "@/lib/kiosk/http";
import {
  admitKioskOrderRequest,
  createKioskOrder,
} from "@/lib/kiosk/server";
import { trustedKioskRequestContext } from "@/lib/kiosk/trusted-request";

export async function POST(request: Request) {
  const context = trustedKioskRequestContext(request.headers, process.env);
  const admission = await admitKioskHttpRequest(
    request,
    context,
    admitKioskOrderRequest
  );
  if (!admission.ok) {
    return admission.response;
  }
  return handleKioskOrderRequest(
    request,
    context,
    (trustedContext, input) =>
      createKioskOrder(trustedContext, admission.permit, input)
  );
}
