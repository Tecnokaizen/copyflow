import { createServerClient } from "@supabase/ssr";
import { getConfig } from "./config";

export type AppCookie = { name: string; value: string };

/**
 * Produce the exact @supabase/ssr auth cookies the app expects for an existing
 * session, using the real library so the cookie format matches what the browser
 * would send. Reuses the session from signup (via setSession) instead of a
 * second password sign-in, keeping auth-server calls minimal.
 */
export async function appAuthCookies(session: {
  accessToken: string;
  refreshToken: string;
}): Promise<AppCookie[]> {
  const c = getConfig();
  const jar: Record<string, string> = {};

  const client = createServerClient(c.supabaseUrl, c.clientKey, {
    cookies: {
      getAll: () =>
        Object.entries(jar).map(([name, value]) => ({ name, value })),
      setAll: (list) => {
        for (const { name, value } of list) {
          jar[name] = value;
        }
      },
    },
  });

  const { error } = await client.auth.setSession({
    access_token: session.accessToken,
    refresh_token: session.refreshToken,
  });
  if (error) {
    throw new Error(`app session setup failed: ${error.message}`);
  }

  return Object.entries(jar).map(([name, value]) => ({ name, value }));
}

function buildCookieHeader(
  cookies: AppCookie[],
  extra: Record<string, string>,
): string {
  return [
    ...cookies.map((c) => `${c.name}=${c.value}`),
    ...Object.entries(extra).map(([k, v]) => `${k}=${v}`),
  ].join("; ");
}

export type AppSession = { cookies: AppCookie[]; tenantSlug: string };

/**
 * Call a Next.js route as a given actor. Sends the auth cookies plus the
 * `gc_preview_tenant` cookie so tenant resolution works on localhost (dev).
 */
export async function fetchAs(
  session: AppSession,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const c = getConfig();
  const headers = new Headers(init.headers);
  headers.set(
    "Cookie",
    buildCookieHeader(session.cookies, { gc_preview_tenant: session.tenantSlug }),
  );
  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  return fetch(new URL(path, c.appBaseUrl), {
    ...init,
    headers,
    redirect: "manual",
  });
}

/** Unauthenticated request to a Next.js route. */
export async function fetchAnon(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const c = getConfig();
  return fetch(new URL(path, c.appBaseUrl), { ...init, redirect: "manual" });
}
