/**
 * Server secret for privileged Supabase access.
 * Prefer the new Secret API Key; keep legacy service_role as fallback.
 * Never expose via NEXT_PUBLIC_*.
 */
export function resolveSupabaseSecretKey(): string | null {
  const secretKey = process.env.SUPABASE_SECRET_KEY?.trim();
  if (secretKey) {
    return secretKey;
  }

  const legacyServiceRole = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (legacyServiceRole) {
    return legacyServiceRole;
  }

  return null;
}
