import { updateSession } from "@/lib/supabase/proxy";
import { loadKioskBootstrap } from "@/lib/kiosk/server";
import { trustedKioskRequestContext } from "@/lib/kiosk/trusted-request";
import { kioskUnavailableResponse } from "@/lib/kiosk/unavailable-response";
import { type NextRequest } from "next/server";

function isKioskPagePath(pathname: string) {
  return pathname === "/kiosk" || pathname === "/kiosk/";
}

export async function proxy(request: NextRequest) {
  if (isKioskPagePath(request.nextUrl.pathname)) {
    const context = trustedKioskRequestContext(request.headers, process.env);
    if (!context) {
      return kioskUnavailableResponse();
    }

    try {
      const bootstrap = await loadKioskBootstrap(context);
      if (!bootstrap) {
        return kioskUnavailableResponse();
      }
    } catch (error) {
      console.error("[proxy /kiosk] Could not load public Kiosk", { error });
      return kioskUnavailableResponse();
    }
  }

  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - images - .svg, .png, .jpg, .jpeg, .gif, .webp
     * Feel free to modify this pattern to include more paths.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
