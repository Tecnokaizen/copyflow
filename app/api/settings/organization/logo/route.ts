import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { deleteObject, putObject } from "@/lib/storage/r2";
import {
  buildLogoStorageKey,
  logoKeyBelongsToTenant,
  storedLogoFromBranding,
  validateLogoBytes,
} from "@/lib/tenant/branding";
import {
  loadOrganizationSettings,
  organizationResponse,
  requireOrganizationEditor,
  saveOrganizationSettings,
} from "@/lib/tenant/organization";

export async function POST(request: NextRequest) {
  const context = await requireOrganizationEditor();
  if (!context) {
    return NextResponse.json(
      { error: "Unauthorized or tenant access denied" },
      { status: 403 }
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid upload" }, { status: 400 });
  }
  if (form.get("tenant_id")) {
    return NextResponse.json({ error: "Invalid upload" }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Logo file is required" }, { status: 400 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const validated = validateLogoBytes(bytes);
  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }

  const key = buildLogoStorageKey(context.tenant.id, randomUUID());
  try {
    await putObject({ key, body: bytes, contentType: validated.contentType });
  } catch {
    return NextResponse.json({ error: "Could not store logo" }, { status: 502 });
  }

  try {
    const saved = await saveOrganizationSettings(context.tenant.id, {
      logo: { storageKey: key, contentType: validated.contentType },
    });
    const previous = saved.previousLogo;
    if (
      previous &&
      previous.storageKey !== key &&
      logoKeyBelongsToTenant(previous.storageKey, context.tenant.id)
    ) {
      await deleteObject({ key: previous.storageKey });
    }
    return NextResponse.json(
      organizationResponse({
        tenantName: context.tenant.name,
        businessName: saved.businessName,
        branding: saved.branding,
      })
    );
  } catch {
    await deleteObject({ key }).catch(() => undefined);
    return NextResponse.json({ error: "Could not save logo" }, { status: 500 });
  }
}

export async function DELETE() {
  const context = await requireOrganizationEditor();
  if (!context) {
    return NextResponse.json(
      { error: "Unauthorized or tenant access denied" },
      { status: 403 }
    );
  }

  const current = await loadOrganizationSettings(context.tenant.id);
  const logo = storedLogoFromBranding(current?.branding);
  if (
    logo &&
    logoKeyBelongsToTenant(logo.storageKey, context.tenant.id)
  ) {
    try {
      await deleteObject({ key: logo.storageKey });
    } catch {
      return NextResponse.json({ error: "Could not delete logo" }, { status: 502 });
    }
  }

  try {
    const saved = await saveOrganizationSettings(context.tenant.id, { logo: null });
    return NextResponse.json(
      organizationResponse({
        tenantName: context.tenant.name,
        businessName: saved.businessName,
        branding: saved.branding,
      })
    );
  } catch {
    return NextResponse.json({ error: "Could not delete logo" }, { status: 500 });
  }
}
