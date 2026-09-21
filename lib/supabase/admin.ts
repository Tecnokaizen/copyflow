import "server-only";

import { createClient } from "@supabase/supabase-js";

import { resolveSupabaseSecretKey } from "@/lib/supabase/secret-key";

export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const secretKey = resolveSupabaseSecretKey();

  if (!url || !secretKey) {
    throw new Error("Missing Supabase secret key configuration");
  }

  return createClient(url, secretKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
