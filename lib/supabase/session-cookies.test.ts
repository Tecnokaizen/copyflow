import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NextRequest, NextResponse } from "next/server";

import { requiresLoginRedirect } from "@/lib/supabase/proxy";
import {
  AUTH_RESPONSE_HEADERS,
  createSessionCookieBridge,
} from "@/lib/supabase/session-cookies";

const REFRESH_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: "lax" as const,
  path: "/",
  maxAge: 60 * 60 * 24 * 30,
};

function cookieLine(response: NextResponse, name: string) {
  return response.headers.getSetCookie().find((line) => line.startsWith(`${name}=`)) ?? "";
}

describe("session cookie bridge", () => {
  it("writes refreshed cookies on the request and the response, with options and cache headers", () => {
    const request = new NextRequest("https://sur4.gestcopy.test/orders");
    const bridge = createSessionCookieBridge(request);

    bridge.setAll(
      [
        {
          name: "sb-access-token",
          value: "renewed-access",
          options: { ...REFRESH_OPTIONS, maxAge: 3600 },
        },
        {
          name: "sb-refresh-token",
          value: "renewed-refresh",
          options: REFRESH_OPTIONS,
        },
      ],
      { ...AUTH_RESPONSE_HEADERS }
    );

    assert.equal(request.cookies.get("sb-access-token")?.value, "renewed-access");
    assert.equal(
      bridge.getAll().find((cookie) => cookie.name === "sb-refresh-token")?.value,
      "renewed-refresh"
    );

    const access = cookieLine(bridge.response, "sb-access-token");
    const refresh = cookieLine(bridge.response, "sb-refresh-token");
    assert.match(access, /renewed-access/);
    assert.match(access, /HttpOnly/i);
    assert.match(access, /Secure/i);
    assert.match(access, /SameSite=Lax/i);
    assert.match(access, /Path=\//i);
    assert.match(refresh, /HttpOnly/i);
    assert.equal(bridge.response.headers.get("Cache-Control"), AUTH_RESPONSE_HEADERS["Cache-Control"]);
    assert.equal(bridge.response.headers.get("Expires"), "0");
    assert.equal(bridge.response.headers.get("Pragma"), "no-cache");
  });

  it("keeps the cache headers when a later cookie write sends an empty header map", () => {
    const request = new NextRequest("https://sur4.gestcopy.test/api/orders");
    const bridge = createSessionCookieBridge(request);
    bridge.setAll(
      [{ name: "sb-access-token", value: "first", options: REFRESH_OPTIONS }],
      { ...AUTH_RESPONSE_HEADERS }
    );
    bridge.setAll(
      [{ name: "sb-access-token", value: "second", options: REFRESH_OPTIONS }],
      {}
    );

    assert.equal(request.cookies.get("sb-access-token")?.value, "second");
    assert.equal(
      bridge.response.headers.get("Cache-Control"),
      AUTH_RESPONSE_HEADERS["Cache-Control"]
    );
    assert.match(cookieLine(bridge.response, "sb-access-token"), /HttpOnly/i);
  });

  it("copies cookie options and cache headers onto a redirect", () => {
    const request = new NextRequest("https://sur4.gestcopy.test/orders/quick");
    const bridge = createSessionCookieBridge(request);
    bridge.setAll(
      [{ name: "sb-refresh-token", value: "rotated", options: REFRESH_OPTIONS }],
      { ...AUTH_RESPONSE_HEADERS }
    );

    const redirect = NextResponse.redirect("https://sur4.gestcopy.test/auth/login");
    bridge.replace(redirect);

    const line = cookieLine(redirect, "sb-refresh-token");
    assert.match(line, /rotated/);
    assert.match(line, /HttpOnly/i);
    assert.match(line, /Secure/i);
    assert.match(line, /SameSite=Lax/i);
    assert.match(line, /Max-Age=/i);
    assert.equal(redirect.headers.get("Cache-Control"), AUTH_RESPONSE_HEADERS["Cache-Control"]);
    assert.equal(redirect.headers.get("Pragma"), "no-cache");
    assert.equal(redirect.headers.get("Expires"), "0");
  });

  it("lets a second tab read the rotated cookie instead of clearing the session", () => {
    const jar = new Map<string, string>();
    const first = new NextRequest("https://sur4.gestcopy.test/orders", {
      headers: { cookie: "sb-refresh-token=shared" },
    });
    const tabA = createSessionCookieBridge(first);
    tabA.setAll(
      [{ name: "sb-refresh-token", value: "rotated-by-a", options: REFRESH_OPTIONS }],
      { ...AUTH_RESPONSE_HEADERS }
    );
    for (const line of tabA.response.headers.getSetCookie()) {
      const [pair] = line.split(";");
      const name = pair.slice(0, pair.indexOf("="));
      const value = pair.slice(pair.indexOf("=") + 1);
      jar.set(name, value);
    }

    const second = new NextRequest("https://sur4.gestcopy.test/api/orders", {
      headers: { cookie: `sb-refresh-token=${jar.get("sb-refresh-token")}` },
    });
    const tabB = createSessionCookieBridge(second);
    assert.equal(tabB.getAll().find((cookie) => cookie.name === "sb-refresh-token")?.value, "rotated-by-a");

    tabB.setAll([], {});
    assert.equal(second.cookies.get("sb-refresh-token")?.value, "rotated-by-a");
    assert.match(cookieLine(tabA.response, "sb-refresh-token"), /HttpOnly/i);
  });
});

describe("login gate", () => {
  it("keeps kiosk, auth and public routes reachable without a session", () => {
    for (const pathname of ["/", "/kiosk", "/kiosk/start", "/auth/login", "/ayuda", "/invitations/accept"]) {
      assert.equal(
        requiresLoginRedirect({ pathname, hasUser: false, isApiRoute: false }),
        false,
        pathname
      );
    }
  });

  it("does not turn an API call without a session into a login redirect", () => {
    assert.equal(
      requiresLoginRedirect({
        pathname: "/api/orders",
        hasUser: false,
        isApiRoute: true,
      }),
      false
    );
  });

  it("still asks for login on the operational pages", () => {
    assert.equal(
      requiresLoginRedirect({
        pathname: "/orders/quick",
        hasUser: false,
        isApiRoute: false,
      }),
      true
    );
  });
});
