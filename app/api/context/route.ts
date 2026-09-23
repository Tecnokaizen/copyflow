import { NextResponse } from "next/server";
import { tenantHasFeature } from "@/lib/features/tenant-has-feature";
import { QUOTES_FEATURE_CODE } from "@/lib/quotes/access";
import { createClient } from "@/lib/supabase/server";
import { resolveCurrentTeamMember } from "@/lib/team/current-member";
import { getCurrentContext } from "@/lib/tenant/current-context";

export async function GET() {
  const context = await getCurrentContext();

  if (!context) {
    return NextResponse.json(
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
  const quotes = await tenantHasFeature(
    supabase,
    context.tenant.id,
    QUOTES_FEATURE_CODE
  );

  return NextResponse.json({
    ...context,
    team_member: teamMember,
    features: {
      quotes,
    },
  });
}