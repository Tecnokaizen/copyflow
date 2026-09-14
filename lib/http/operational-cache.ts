import { NextResponse } from "next/server";

/** HTTP cache policy for tenant-scoped operational JSON (orders, dashboard). */
export const OPERATIONAL_CACHE_CONTROL =
  "private, no-store, max-age=0, must-revalidate";

export function isOperationalApiPath(pathname: string): boolean {
  return (
    pathname === "/api/orders" ||
    pathname.startsWith("/api/orders/") ||
    pathname === "/api/dashboard"
  );
}

export function operationalJson(
  data: unknown,
  init?: ResponseInit
): NextResponse {
  const headers = new Headers(init?.headers);
  headers.set("Cache-Control", OPERATIONAL_CACHE_CONTROL);
  headers.set("Pragma", "no-cache");
  return NextResponse.json(data, { ...init, headers });
}
