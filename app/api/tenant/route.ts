import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { getCurrentTenant } from "@/lib/tenant/current-tenant";
import { getSubdomainFromHostname } from "@/lib/tenant/hostname";

export async function GET() {
  const headersList = await headers();

  const hostname =
    headersList.get("x-forwarded-host") ??
    headersList.get("host") ??
    "";

  const slug = getSubdomainFromHostname(hostname);
  const tenant = await getCurrentTenant();

  return NextResponse.json({
    hostname,
    slug,
    tenant,
  });
}