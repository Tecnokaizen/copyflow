import { updateSession } from "@/lib/supabase/proxy";
import { loadKioskBootstrap } from "@/lib/kiosk/server";
import { trustedKioskRequestContext } from "@/lib/kiosk/trusted-request";
import { kioskUnavailableResponse } from "@/lib/kiosk/unavailable-response";
import { createServerClient } from "@supabase/ssr";
import { hasEnvVars } from "@/lib/utils";
import { getSubdomainFromHostname } from "@/lib/tenant/hostname";
import {
  loadActiveTenantIdBySlug,
  loadTenantEntitlement,
} from "@/lib/billing/entitlement-access";
import {
  commercialEntitlementDecision,
  isEntitlementExemptPath,
  isKioskEntitlementPath,
} from "@/lib/billing/entitlement-paths";
import {
  isTenantAppExemptPath,
  resolveInactiveTenantState,
} from "@/lib/tenant/inactive-gate";
import { subscriptionRequiredResponse } from "@/lib/tenant/operational-context";
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

  const sessionResponse = await updateSession(request);

  if (
    hasEnvVars &&
    sessionResponse.status >= 200 &&
    sessionResponse.status < 400
  ) {
    const host =
      request.headers.get("x-forwarded-host") ??
      request.headers.get("host") ??
      "";
    const slug = getSubdomainFromHostname(host);

    // Central provisioning gate: inactive tenants must not render the app UI.
    // APIs and kiosk stay out of this redirect; entitlement below still applies.
    if (slug && !isTenantAppExemptPath(request.nextUrl.pathname)) {
      try {
        const supabase = createServerClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
          {
            cookies: {
              getAll() {
                return request.cookies.getAll();
              },
              setAll() {
                // session cookies already applied by updateSession
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
          sessionResponse.cookies.getAll().forEach((cookie) => {
            redirect.cookies.set(cookie.name, cookie.value);
          });
          return redirect;
        }
      } catch (error) {
        console.error("[proxy] inactive tenant gate failed", { error });
      }
    }

    if (slug && !isEntitlementExemptPath(request.nextUrl.pathname)) {
      const pathname = request.nextUrl.pathname;
      const kiosk = isKioskEntitlementPath(pathname);
      try {
        const supabase = createServerClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
          {
            cookies: {
              getAll() {
                return request.cookies.getAll();
              },
              setAll() {},
            },
          }
        );
        const {
          data: { user },
        } = await supabase.auth.getUser();
        const tenantId = await loadActiveTenantIdBySlug(slug);
        let isMember = false;
        if (user && tenantId && !kiosk) {
          const { data: membership } = await supabase
            .from("memberships")
            .select("role")
            .eq("user_id", user.id)
            .eq("tenant_id", tenantId)
            .eq("active", true)
            .maybeSingle();
          isMember = Boolean(membership);
        }

        let entitlementAllowed: boolean | null = null;
        const shouldResolve = kiosk
          ? Boolean(tenantId)
          : Boolean(user && tenantId && isMember);
        if (shouldResolve && tenantId) {
          try {
            const entitlement = await loadTenantEntitlement(tenantId);
            entitlementAllowed = entitlement.allowed;
          } catch (error) {
            console.error("[proxy] entitlement lookup failed", {
              message: error instanceof Error ? error.message : "unknown",
            });
            entitlementAllowed = null;
          }
        }

        const decision = commercialEntitlementDecision({
          pathname,
          slug,
          userId: user?.id ?? null,
          tenantId,
          isMember,
          entitlementAllowed,
        });

        if (decision === "kiosk_unavailable") {
          return kioskUnavailableResponse();
        }
        if (decision === "subscription_required") {
          if (pathname.startsWith("/api/")) {
            const denied = subscriptionRequiredResponse();
            sessionResponse.cookies.getAll().forEach((cookie) => {
              denied.cookies.set(cookie.name, cookie.value);
            });
            return denied;
          }
          const url = request.nextUrl.clone();
          url.pathname = "/subscription-required";
          url.search = "";
          const redirect = NextResponse.redirect(url);
          sessionResponse.cookies.getAll().forEach((cookie) => {
            redirect.cookies.set(cookie.name, cookie.value);
          });
          return redirect;
        }
      } catch (error) {
        console.error("[proxy] entitlement gate failed", {
          message: error instanceof Error ? error.message : "unknown",
        });
        if (kiosk) {
          return kioskUnavailableResponse();
        }
      }
    }
  }

  return sessionResponse;
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
