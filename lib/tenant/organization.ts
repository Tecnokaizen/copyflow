import "server-only";

import { canManageOrganizationIdentity } from "@/lib/auth/membership-roles";
import { createClient } from "@/lib/supabase/server";
import {
  mergeBranding,
  publicOrganizationIdentity,
  storedLogoFromBranding,
  type PublicBrandColor,
  type StoredLogo,
} from "@/lib/tenant/branding";
import { getCurrentContext } from "@/lib/tenant/current-context";

export async function requireOrganizationEditor() {
  const context = await getCurrentContext();
  if (!context || !canManageOrganizationIdentity(context.membership.role)) {
    return null;
  }
  return context;
}

export async function loadOrganizationSettings(tenantId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tenant_settings")
    .select("business_name, branding")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export function organizationResponse(input: {
  tenantName: string;
  businessName?: string | null;
  branding: unknown;
}) {
  return publicOrganizationIdentity({
    businessName: input.businessName,
    tenantName: input.tenantName,
    branding: input.branding,
  });
}

export async function saveOrganizationSettings(
  tenantId: string,
  patch: { businessName?: string | null; brandColor?: PublicBrandColor; logo?: StoredLogo | null }
) {
  const current = await loadOrganizationSettings(tenantId);
  const supabase = await createClient();
  const nextBranding = mergeBranding(current?.branding, {
    brandColor: patch.brandColor,
    logo: patch.logo,
  });
  const update: { business_name?: string | null; branding: Record<string, unknown>; logo_url?: null } = {
    branding: nextBranding,
  };
  if (patch.businessName !== undefined) {
    update.business_name = patch.businessName?.trim() ? patch.businessName.trim() : null;
  }
  if (patch.logo !== undefined) {
    update.logo_url = null;
  }
  const { data, error } = await supabase
    .from("tenant_settings")
    .update(update)
    .eq("tenant_id", tenantId)
    .select("tenant_id")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Organization settings row was not updated");
  return {
    branding: nextBranding,
    businessName:
      patch.businessName !== undefined
        ? update.business_name
        : current?.business_name,
    previousLogo: storedLogoFromBranding(current?.branding),
  };
}
