import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getConfig } from "./config";

const noPersist = {
  auth: { persistSession: false, autoRefreshToken: false },
} as const;

/** Anonymous client (publishable key), same role as an unauthenticated browser. */
export function anonClient(): SupabaseClient {
  const c = getConfig();
  return createClient(c.supabaseUrl, c.clientKey, noPersist);
}

/**
 * Authenticated client for a specific user, using the user's real JWT.
 * This is the exact PostgREST auth context the app uses, so it is the correct
 * client for RLS assertions. Never bypasses RLS.
 */
export function userClient(accessToken: string): SupabaseClient {
  const c = getConfig();
  return createClient(c.supabaseUrl, c.clientKey, {
    ...noPersist,
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

/**
 * Service-role client — bypasses RLS. ONLY for controlled setup/teardown
 * (e.g. deleting test tenants/users). MUST NOT be used to validate isolation.
 */
export function serviceClient(): SupabaseClient {
  const c = getConfig();
  return createClient(c.supabaseUrl, c.serviceRoleKey, noPersist);
}
