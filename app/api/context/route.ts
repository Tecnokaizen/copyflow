import { NextResponse } from "next/server";
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

  return NextResponse.json({
    ...context,
    team_member: teamMember,
  });
}