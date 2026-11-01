/**
 * Service-role helpers for the SUR4 E10 tenants (seed and the feature off/on
 * phase of the runner). Server-side only; every call names a slug from
 * SUR4_MATRIX, so no other tenant is ever read or written.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { ORDER_FEATURE_CODES, type OrderFeatureKey } from "../../lib/orders/order-features";
import { SUR4_TENANT_SLUGS, type Sur4TenantSlug, type Sur4Targets } from "./guard";

export function adminClient(targets: Sur4Targets, secretKey: string): SupabaseClient {
  if (!secretKey) throw new Error("E2E_SUPABASE_SECRET_KEY is required (server-side only)");
  return createClient(targets.supabaseUrl, secretKey, { auth: { autoRefreshToken: false, persistSession: false } });
}

function assertSur4(slug: string): asserts slug is Sur4TenantSlug {
  if (!(SUR4_TENANT_SLUGS as readonly string[]).includes(slug)) throw new Error(`refusing to touch tenant ${slug}`);
}

export async function tenantIdOf(admin: SupabaseClient, slug: Sur4TenantSlug): Promise<string | null> {
  assertSur4(slug);
  const { data, error } = await admin.from("tenants").select("id, active, provisioning_state").eq("slug", slug).maybeSingle();
  if (error) throw new Error(`tenant lookup failed: ${error.message}`);
  if (!data) return null;
  if (!data.active || data.provisioning_state !== "ready") {
    throw new Error(`tenant ${slug} exists but is not active/ready; fix manually, the seed never repairs it`);
  }
  return data.id as string;
}

export async function hasFeature(admin: SupabaseClient, tenantId: string, key: OrderFeatureKey): Promise<boolean> {
  const { data, error } = await admin.rpc("tenant_has_feature", { p_tenant_id: tenantId, p_code: ORDER_FEATURE_CODES[key] });
  if (error) throw new Error(`tenant_has_feature failed: ${error.message}`);
  return data === true;
}

/** Audited grant (set_tenant_feature_v2): only when the state differs, so re-runs add no events. */
export async function setFeature(
  admin: SupabaseClient,
  slug: Sur4TenantSlug,
  tenantId: string,
  key: OrderFeatureKey,
  enabled: boolean,
  reason: string,
  operator: string,
): Promise<"changed" | "unchanged"> {
  assertSur4(slug);
  if ((await hasFeature(admin, tenantId, key)) === enabled) return "unchanged";
  const { error } = await admin.rpc("set_tenant_feature_v2", {
    p_slug: slug,
    p_code: ORDER_FEATURE_CODES[key],
    p_enabled: enabled,
    p_limit: null,
    p_reason: reason,
    p_review_at: null,
    p_operator: operator,
  });
  if (error) throw new Error(`set_tenant_feature_v2(${slug}, ${key}) failed: ${error.message}`);
  if ((await hasFeature(admin, tenantId, key)) !== enabled) throw new Error(`${slug}: ${key} did not change`);
  return "changed";
}
