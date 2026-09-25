import { NextResponse } from "next/server";
import { getObjectBytes } from "@/lib/storage/r2";
import {
  logoKeyBelongsToTenant,
  storedLogoFromBranding,
} from "@/lib/tenant/branding";
import { loadOrganizationSettings } from "@/lib/tenant/organization";
import { getCurrentContext } from "@/lib/tenant/current-context";

export async function GET() {
  const context = await getCurrentContext();
  if (!context) {
    return NextResponse.json(
      { error: "Unauthorized or tenant access denied" },
      { status: 403 }
    );
  }

  const settings = await loadOrganizationSettings(context.tenant.id);
  const logo = storedLogoFromBranding(settings?.branding);
  if (!logo || !logoKeyBelongsToTenant(logo.storageKey, context.tenant.id)) {
    return NextResponse.json({ error: "Logo not found" }, { status: 404 });
  }

  const object = await getObjectBytes({ key: logo.storageKey });
  if (!object) {
    return NextResponse.json({ error: "Logo not found" }, { status: 404 });
  }

  return new NextResponse(Buffer.from(object.body), {
    headers: {
      "Content-Type": logo.contentType,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
