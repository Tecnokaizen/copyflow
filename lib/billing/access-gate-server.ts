import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  parseMemberBillingAccess,
  type MemberBillingAccess,
} from "@/lib/billing/access-gate";

/**
 * Commercial access of the signed-in user's tenant (by slug). null when the
 * user is not an active member or the read fails: the caller then does not
 * decide, and the database trigger remains the backstop for writes.
 */
export async function readMemberBillingAccess(
  supabase: SupabaseClient,
  slug: string
): Promise<MemberBillingAccess | null> {
  const { data, error } = await supabase.rpc("current_tenant_billing_access_v1", {
    p_tenant_slug: slug,
  });
  if (error) {
    console.error("[billing.access-gate] read failed", { code: error.code });
    return null;
  }
  return parseMemberBillingAccess(data);
}
