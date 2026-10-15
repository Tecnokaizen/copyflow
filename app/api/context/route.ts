import { earlyAccessContext } from "@/lib/features/early-access";
import { resolveProEarlyAccess } from "@/lib/features/early-access-server";
import { tenantHasFeature } from "@/lib/features/tenant-has-feature";
import { operationalJson } from "@/lib/http/operational-cache";
import { QUOTES_FEATURE_CODE } from "@/lib/quotes/access";
import { createClient } from "@/lib/supabase/server";
import { resolveCurrentTeamMember } from "@/lib/team/current-member";
import { publicOrganizationIdentity } from "@/lib/tenant/branding";
import { loadOrganizationSettings } from "@/lib/tenant/organization";
import { getCurrentContext } from "@/lib/tenant/current-context";

export async function GET() {
  const context = await getCurrentContext();

  if (!context) {
    return operationalJson(
      { error: "Unauthorized or tenant access denied" },
      { status: 403 }
    );
  }

  const supabase = await createClient();
  const teamMember = await resolveCurrentTeamMember(
    supabase,
    context.tenant.id,
    context.user.id
  );
  const [quotes, proEarlyAccess] = await Promise.all([
    tenantHasFeature(supabase, context.tenant.id, QUOTES_FEATURE_CODE),
    resolveProEarlyAccess(supabase, context.tenant.id),
  ]);
  let settings: Awaited<ReturnType<typeof loadOrganizationSettings>> = null;
  try {
    settings = await loadOrganizationSettings(context.tenant.id);
  } catch {
    settings = null;
  }
  const identity = publicOrganizationIdentity({
    businessName: settings?.business_name,
    tenantName: context.tenant.name,
    branding: settings?.branding,
  });

  // Per-user, per-tenant payload: never cache it in a shared cache.
  return operationalJson({
    ...context,
    tenant: {
      id: context.tenant.id,
      name: context.tenant.name,
      slug: context.tenant.slug,
      business_name: identity.business_name,
      display_name: identity.display_name,
      logo_url: identity.logo_url,
      branding: identity.branding,
    },
    team_member: teamMember,
    features: {
      quotes,
    },
    early_access: earlyAccessContext(proEarlyAccess),
  });
}