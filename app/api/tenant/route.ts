import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentContext } from "@/lib/tenant/current-context";
import {
  getRequestHostname,
  resolveRequestTenantSlug,
} from "@/lib/tenant/request-host";

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

  const hostname = await getRequestHostname();
  const slug = await resolveRequestTenantSlug();

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
    tenant: {
      name: context.tenant.name,
      slug: context.tenant.slug,
    },
  });
}
