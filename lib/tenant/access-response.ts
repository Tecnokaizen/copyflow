import { NextResponse } from "next/server";

import type { CurrentAccess } from "@/lib/tenant/access";
import { accessFailureResponse, roleDeniedResponse } from "@/lib/tenant/access-http";
import { readCurrentAccess } from "@/lib/tenant/current-access";

export { accessFailureResponse, roleDeniedResponse };

export async function requireCurrentAccess(
  route: string
): Promise<
  | { ok: true; context: Extract<CurrentAccess, { ok: true }>["context"] }
  | { ok: false; response: NextResponse }
> {
  const access = await readCurrentAccess();
  if (!access.ok) {
    return { ok: false, response: accessFailureResponse(access.failure, route) };
  }
  return access;
}
