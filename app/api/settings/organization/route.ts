import { NextRequest, NextResponse } from "next/server";
import { parseBrandColor } from "@/lib/tenant/branding";
import {
  loadOrganizationSettings,
  organizationResponse,
  requireOrganizationEditor,
  saveOrganizationSettings,
} from "@/lib/tenant/organization";

export async function GET() {
  const context = await requireOrganizationEditor();
  if (!context) {
    return NextResponse.json(
      { error: "Unauthorized or tenant access denied" },
      { status: 403 }
    );
  }

  try {
    const settings = await loadOrganizationSettings(context.tenant.id);
    return NextResponse.json(
      organizationResponse({
        tenantName: context.tenant.name,
        businessName: settings?.business_name,
        branding: settings?.branding,
      })
    );
  } catch {
    return NextResponse.json(
      { error: "Could not load organization" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  const context = await requireOrganizationEditor();
  if (!context) {
    return NextResponse.json(
      { error: "Unauthorized or tenant access denied" },
      { status: 403 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const record = body as Record<string, unknown>;
  if ("tenant_id" in record || "storage_key" in record || "logo_url" in record) {
    return NextResponse.json({ error: "Invalid organization fields" }, { status: 400 });
  }

  const patch: { businessName?: string | null; brandColor?: string | null } = {};
  if ("business_name" in record) {
    if (record.business_name != null && typeof record.business_name !== "string") {
      return NextResponse.json({ error: "Invalid business name" }, { status: 400 });
    }
    patch.businessName =
      typeof record.business_name === "string" ? record.business_name : null;
  }
  if ("brand_color" in record) {
    const color = parseBrandColor(record.brand_color);
    if (color === undefined) {
      return NextResponse.json({ error: "Invalid brand color" }, { status: 400 });
    }
    patch.brandColor = color;
  }

  try {
    const saved = await saveOrganizationSettings(context.tenant.id, patch);
    return NextResponse.json(
      organizationResponse({
        tenantName: context.tenant.name,
        businessName: saved.businessName,
        branding: saved.branding,
      })
    );
  } catch {
    return NextResponse.json(
      { error: "Could not save organization" },
      { status: 500 }
    );
  }
}
