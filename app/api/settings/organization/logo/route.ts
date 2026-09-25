import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { deleteObject, putObject } from "@/lib/storage/r2";
import {
  buildLogoStorageKey,
  logoDeclaredSizeIsAllowed,
  logoKeyBelongsToTenant,
  storedLogoFromBranding,
  validateLogoBytes,
} from "@/lib/tenant/branding";
import { commitLogoRemoval, commitLogoReplacement } from "@/lib/tenant/logo-commit";
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

  if (!logoDeclaredSizeIsAllowed(file.size)) {
    return NextResponse.json({ error: "Invalid logo file" }, { status: 400 });
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

  let saved: Awaited<ReturnType<typeof saveOrganizationSettings>> | undefined;
  const outcome = await commitLogoReplacement({
    newKey: key,
    save: async () => {
      saved = await saveOrganizationSettings(context.tenant.id, {
        logo: { storageKey: key, contentType: validated.contentType },
      });
      const previous = saved.previousLogo;
      return {
        previousKey:
          previous &&
          previous.storageKey !== key &&
          logoKeyBelongsToTenant(previous.storageKey, context.tenant.id)
            ? previous.storageKey
            : null,
      };
    },
    remove: (objectKey) => deleteObject({ key: objectKey }),
    warn: (message) => {
      console.warn("[organization.logo]", message, { tenantId: context.tenant.id });
    },
  });
  if (outcome === "save_failed" || !saved) {
    return NextResponse.json({ error: "Could not save logo" }, { status: 500 });
  }
  return NextResponse.json(
    organizationResponse({
      tenantName: context.tenant.name,
      businessName: saved.businessName,
      branding: saved.branding,
    })
  );
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
  const currentKey =
    logo && logoKeyBelongsToTenant(logo.storageKey, context.tenant.id)
      ? logo.storageKey
      : null;

  let saved: Awaited<ReturnType<typeof saveOrganizationSettings>> | undefined;
  const outcome = await commitLogoRemoval({
    currentKey,
    save: async () => {
      saved = await saveOrganizationSettings(context.tenant.id, { logo: null });
    },
    remove: (objectKey) => deleteObject({ key: objectKey }),
    warn: (message) => {
      console.warn("[organization.logo]", message, { tenantId: context.tenant.id });
    },
  });
  if (outcome === "save_failed" || !saved) {
    return NextResponse.json({ error: "Could not delete logo" }, { status: 500 });
  }
  return NextResponse.json(
    organizationResponse({
      tenantName: context.tenant.name,
      businessName: saved.businessName,
      branding: saved.branding,
    })
  );
}
