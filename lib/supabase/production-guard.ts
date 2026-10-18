import { createHash } from "node:crypto";

/**
 * Local-development interlock, evaluated by next.config.ts on `next dev`,
 * `next build` and `next start`: only Vercel Production deployments may use the
 * Production Supabase project. Workstations and Preview builds refuse to start
 * against it unless GESTCOPY_ALLOW_PRODUCTION_DATABASE=1 is set for that command.
 *
 * The ref is compared by SHA-256 so it stays out of the repository (release
 * gate rule, ci/release-gate/production-safety.ts; same digest as
 * e2e/staging/guard.ts).
 */
const PRODUCTION_SUPABASE_REF_SHA256 = "fc465d69aa2021e82beadd00350a2ad1aae651a61d2e4ea94ccf3aa208e9ef35";

export const PRODUCTION_DATABASE_OVERRIDE = "GESTCOPY_ALLOW_PRODUCTION_DATABASE";

type Env = Record<string, string | undefined>;

export class ProductionDatabaseGuardError extends Error {
  constructor(message: string) {
    super(`Production database guard: ${message}`);
    this.name = "ProductionDatabaseGuardError";
  }
}

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

/** Any `<ref>.supabase.co` in the value, so a path, a missing scheme or upper case do not hide it. */
export function isProductionSupabaseUrl(value: string | undefined): boolean {
  if (!value) return false;
  for (const match of value.toLowerCase().matchAll(/([a-z0-9]{20})\.supabase\.(?:co|in)\b/g)) {
    if (sha256(match[1]) === PRODUCTION_SUPABASE_REF_SHA256) return true;
  }
  return false;
}

export function assertProductionDatabaseAllowed(env: Env = process.env): void {
  if (!isProductionSupabaseUrl(env.NEXT_PUBLIC_SUPABASE_URL)) return;
  if (env.VERCEL === "1" && env.VERCEL_ENV === "production") return;
  if (env[PRODUCTION_DATABASE_OVERRIDE] === "1") return;
  throw new ProductionDatabaseGuardError(
    "NEXT_PUBLIC_SUPABASE_URL points to the Production Supabase project. " +
      "Outside Vercel Production, use Staging or a local Supabase stack in .env.local. " +
      `To run against Production on purpose, set ${PRODUCTION_DATABASE_OVERRIDE}=1 for that command only.`,
  );
}
