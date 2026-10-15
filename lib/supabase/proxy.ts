import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { hasEnvVars } from "../utils";
import { createSessionCookieBridge } from "@/lib/supabase/session-cookies";
import {
  PREVIEW_TENANT_COOKIE,
  PREVIEW_TENANT_QUERY,
  isTenantOverrideAllowed,
  parsePreviewTenantSlug,
} from "@/lib/tenant/preview-tenant";
import { allowsUnauthenticatedPath } from "@/lib/invitations/public-path";

export function requiresLoginRedirect(input: {
  pathname: string;
  hasUser: boolean;
  isApiRoute: boolean;
}) {
  return (
    !input.isApiRoute &&
    !input.hasUser &&
    !allowsUnauthenticatedPath(input.pathname)
  );
}

function applyPreviewTenantOverride(
  request: NextRequest,
  bridge: ReturnType<typeof createSessionCookieBridge>
): NextResponse | null {
  if (!isTenantOverrideAllowed()) {
    return null;
  }

  const raw =
    request.nextUrl.searchParams.get(PREVIEW_TENANT_QUERY) ??
    request.nextUrl.searchParams.get("slug");
  const slug = parsePreviewTenantSlug(raw);

  if (!slug) {
    return null;
  }

  const url = request.nextUrl.clone();
  url.searchParams.delete(PREVIEW_TENANT_QUERY);
  url.searchParams.delete("slug");

  const redirectResponse = NextResponse.redirect(url);
  bridge.replace(redirectResponse);
  redirectResponse.cookies.set(PREVIEW_TENANT_COOKIE, slug, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure:
      process.env.VERCEL_ENV === "preview" ||
      process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 14,
  });

  return redirectResponse;
}

export async function updateSession(request: NextRequest) {
  const bridge = createSessionCookieBridge(request);

  // If the env vars are not set, skip proxy check. You can remove this
  // once you setup the project.
  if (!hasEnvVars) {
    return bridge;
  }

  // With Fluid compute, don't put this client in a global environment
  // variable. Always create a new one on each request.
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return bridge.getAll();
        },
        setAll(cookiesToSet, headers) {
          bridge.setAll(cookiesToSet, headers);
        },
      },
    },
  );

  // Do not run code between createServerClient and
  // supabase.auth.getClaims(). A simple mistake could make it very hard to debug
  // issues with users being randomly logged out.

  // IMPORTANT: If you remove getClaims() and you use server-side rendering
  // with the Supabase client, your users may be randomly logged out.
  const { data } = await supabase.auth.getClaims();
  const user = data?.claims;

  if (user) {
    bridge.rememberPrivateCache();
  }

  const isApiRoute = request.nextUrl.pathname.startsWith("/api/");

  if (
    requiresLoginRedirect({
      pathname: request.nextUrl.pathname,
      hasUser: Boolean(user),
      isApiRoute,
    })
  ) {
    // no user, potentially respond by redirecting the user to the login page
    // API routes are excluded: handlers return their own 401/403 JSON.
    // Preserve the original path+query as `next` (encoded) so post-login can return.
    const returnTo = `${request.nextUrl.pathname}${request.nextUrl.search}`;
    const url = request.nextUrl.clone();
    url.pathname = "/auth/login";
    url.search = "";
    url.searchParams.set("next", returnTo);
    const redirectResponse = NextResponse.redirect(url);
    bridge.replace(redirectResponse);
    return bridge;
  }

  const previewOverride = applyPreviewTenantOverride(request, bridge);
  if (previewOverride) {
    return bridge;
  }

  // IMPORTANT: You *must* return the supabaseResponse object as it is.
  // If you're creating a new response object with NextResponse.next() make sure to:
  // 1. Pass the request in it, like so:
  //    const myNewResponse = NextResponse.next({ request })
  // 2. Copy over the cookies, like so:
  //    myNewResponse.cookies.setAll(supabaseResponse.cookies.getAll())
  // 3. Change the myNewResponse object to fit your needs, but avoid changing
  //    the cookies!
  // 4. Finally:
  //    return myNewResponse
  // If this is not done, you may be causing the browser and server to go out
  // of sync and terminate the user's session prematurely!

  return bridge;
}
