import type { SupabaseClient } from "@supabase/supabase-js";
import {
  evaluateLinkChange,
  type LinkChangeResult,
} from "@/lib/team/link";

const CREATE_TARGET_ID = "00000000-0000-4000-8000-000000000000";

export async function resolveRequestedUserLink(
  supabase: SupabaseClient,
  input: {
    sessionTenantId: string;
    targetMemberId?: string;
    userId: string | null;
  }
): Promise<LinkChangeResult> {
  if (input.userId === null) {
    return { ok: true, userId: null };
  }

  const { data: membershipRow } = await supabase
    .from("memberships")
    .select("tenant_id, user_id, active")
    .eq("tenant_id", input.sessionTenantId)
    .eq("user_id", input.userId)
    .maybeSingle();

  let membership: {
    tenantId: string;
    userId: string;
    active: boolean;
  } | null = null;

  if (
    membershipRow &&
    typeof membershipRow.tenant_id === "string" &&
    typeof membershipRow.user_id === "string"
  ) {
    membership = {
      tenantId: membershipRow.tenant_id,
      userId: membershipRow.user_id,
      active: membershipRow.active === true,
    };
  }

  const { data: existing } = await supabase
    .from("team_members")
    .select("id")
    .eq("tenant_id", input.sessionTenantId)
    .eq("user_id", input.userId)
    .maybeSingle();

  const existingLinkMemberId =
    existing && typeof existing.id === "string" ? existing.id : null;

  return evaluateLinkChange({
    targetMemberId: input.targetMemberId ?? CREATE_TARGET_ID,
    sessionTenantId: input.sessionTenantId,
    userId: input.userId,
    membership,
    existingLinkMemberId,
  });
}

export function linkDecisionStatus(
  code:
    | "already_linked"
    | "membership_missing"
    | "membership_inactive"
    | "tenant_mismatch"
) {
  if (code === "already_linked") {
    return 409;
  }
  if (code === "tenant_mismatch") {
    return 403;
  }
  return 400;
}
