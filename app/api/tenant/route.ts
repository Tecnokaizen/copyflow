import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { getCurrentContext } from "@/lib/tenant/current-context";
import { getSubdomainFromHostname } from "@/lib/tenant/hostname";

export async function GET() {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    if (userError) {
      console.error("[GET /api/tenant] Could not verify session", {
        error: userError,
      });
    }

    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 }
    );
  }

  const headersList = await headers();

  const hostname =
    headersList.get("x-forwarded-host") ??
    headersList.get("host") ??
    "";

  const slug = getSubdomainFromHostname(hostname);

  if (!slug) {
    return NextResponse.json({
      hostname,
      slug: null,
      tenant: null,
    });
  }

  const context = await getCurrentContext();

  if (!context) {
    return NextResponse.json(
      { error: "Tenant not found" },
      { status: 404 }
    );
  }

  return NextResponse.json({
    hostname,
    slug,
    tenant: context.tenant,
  });
}
