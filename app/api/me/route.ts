import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 }
    );
  }

  const { data: memberships, error: membershipsError } = await supabase
    .from("memberships")
    .select(`
      tenant_id,
      role,
      active,
      tenants (
        id,
        name,
        slug
      )
    `)
    .eq("user_id", user.id)
    .eq("active", true);

  if (membershipsError) {
    console.error("[GET /api/me] Could not load memberships", {
      userId: user.id,
      code: membershipsError.code,
      message: membershipsError.message,
      details: membershipsError.details,
      hint: membershipsError.hint,
    });

    return NextResponse.json(
      { error: "Could not load memberships" },
      { status: 500 }
    );
  }

  return NextResponse.json({
    user: {
      id: user.id,
      email: user.email,
    },
    memberships,
  });
}