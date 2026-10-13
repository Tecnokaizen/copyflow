import { NextResponse, type NextRequest } from "next/server";
import type { CookieOptions } from "@supabase/ssr";

/**
 * Headers the installed @supabase/ssr 0.12 client asks the host to set
 * whenever it writes auth cookies. They are delivered only on the first
 * cookie write of a client and must not be dropped when a later write
 * passes an empty header map.
 */
export const AUTH_RESPONSE_HEADERS = {
  "Cache-Control": "private, no-cache, no-store, must-revalidate, max-age=0",
  Expires: "0",
  Pragma: "no-cache",
} as const;

export type SessionCookieWrite = {
  name: string;
  value: string;
  options: CookieOptions;
};

type HeaderTarget = {
  cookies: {
    set: (
      name: string,
      value: string,
      options?: CookieOptions
    ) => void;
  };
  headers: {
    set: (name: string, value: string) => void;
  };
};

/**
 * Remembers every cookie the Supabase client writes during one request,
 * including its options, plus the cache headers from the first write.
 * Redirects must be stamped from this bridge: Next's `cookies.getAll()`
 * does not return httpOnly, secure, sameSite or maxAge.
 */
export function createSessionCookieBridge(request: NextRequest) {
  const cookies = new Map<string, SessionCookieWrite>();
  const headers = new Map<string, string>();
  let response = NextResponse.next({ request });
  let fixed = false;

  function applyTo<T extends HeaderTarget>(target: T) {
    for (const cookie of cookies.values()) {
      target.cookies.set(cookie.name, cookie.value, cookie.options);
    }
    for (const [name, value] of headers) {
      target.headers.set(name, value);
    }
    return target;
  }

  function remember(
    cookiesToSet: SessionCookieWrite[],
    incomingHeaders?: Record<string, string>
  ) {
    for (const cookie of cookiesToSet) {
      cookies.set(cookie.name, cookie);
      request.cookies.set(cookie.name, cookie.value);
    }
    if (!incomingHeaders) {
      return;
    }
    for (const [name, value] of Object.entries(incomingHeaders)) {
      if (value) {
        headers.set(name, value);
      }
    }
  }

  function publish() {
    if (fixed) {
      applyTo(response);
      return;
    }
    response = NextResponse.next({ request });
    applyTo(response);
  }

  return {
    get response() {
      return response;
    },
    getAll() {
      return request.cookies.getAll();
    },
    setAll(
      cookiesToSet: SessionCookieWrite[],
      incomingHeaders: Record<string, string> = {}
    ) {
      remember(cookiesToSet, incomingHeaders);
      publish();
    },
    rememberPrivateCache() {
      remember([], { ...AUTH_RESPONSE_HEADERS });
      applyTo(response);
    },
    replace<T extends HeaderTarget>(target: T) {
      fixed = true;
      response = applyTo(target) as unknown as NextResponse;
      return target;
    },
    applyTo,
  };
}
