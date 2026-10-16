import { updateSession } from "@/lib/supabase/proxy";
import { loadKioskBootstrap } from "@/lib/kiosk/server";
import { trustedKioskRequestContext } from "@/lib/kiosk/trusted-request";
import { kioskUnavailableResponse } from "@/lib/kiosk/unavailable-response";
import { createServerClient } from "@supabase/ssr";
import { hasEnvVars } from "@/lib/utils";
import {
  classifyRequestHost,
  isHostGateExemptPath,
} from "@/lib/tenant/trusted-host";
import { untrustedHostResponse } from "@/lib/tenant/untrusted-host-response";
import {
  isTenantAppExemptPath,
  resolveInactiveTenantState,
} from "@/lib/tenant/inactive-gate";
import { type NextRequest, NextResponse } from "next/server";

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

  // Fail closed on any host that is not explicitly trusted (spoofed or
  // inconsistent forwarding headers, unknown/custom domains). Runs before any
  // session or tenant work. Only an explicit list of exact paths is exempt (see
  // HOST_GATE_EXEMPT_PATHS): each authenticates by signature, secret or its own
  // stricter validator and never trusts the host.
  const hostClassification = classifyRequestHost(request.headers, process.env);
  if (
    hostClassification.status === "untrusted" &&
    !isHostGateExemptPath(request.nextUrl.pathname)
  ) {
    return untrustedHostResponse();
  }

  const session = await updateSession(request);

  // Central provisioning gate: inactive tenants must not render the app UI.
  if (
    hasEnvVars &&
    !isTenantAppExemptPath(request.nextUrl.pathname) &&
    session.response.status >= 200 &&
    session.response.status < 400
  ) {
    const slug =
      hostClassification.status === "tenant" ? hostClassification.slug : null;
    if (slug) {
      try {
        const supabase = createServerClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
          {
            cookies: {
              getAll() {
                return session.getAll();
              },
              setAll(cookiesToSet, headers) {
                session.setAll(cookiesToSet, headers);
              },
            },
          }
        );
        const reason = await resolveInactiveTenantState(supabase, slug);
        if (reason) {
          const url = request.nextUrl.clone();
          url.pathname = "/tenant-inactive";
          url.search = `?reason=${encodeURIComponent(reason)}`;
          const redirect = NextResponse.redirect(url);
          session.applyTo(redirect);
          return redirect;
        }
      } catch (error) {
        console.error("[proxy] inactive tenant gate failed", { error });
      }
    }
  }

  return session.response;
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
