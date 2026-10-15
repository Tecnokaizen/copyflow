import type { SupabaseClient } from "@supabase/supabase-js";
import {
  canViewProEarlyAccess,
  PRO_EARLY_ACCESS_FEATURE_CODE,
} from "@/lib/features/early-access";
import { tenantHasFeature } from "@/lib/features/tenant-has-feature";

/**
 * Program membership through the session client and the existing RPC.
 * Any RPC error, unexpected value or thrown exception resolves to false.
 */
export async function resolveProEarlyAccess(
  supabase: SupabaseClient,
  tenantId: string
) {
  try {
    return await tenantHasFeature(
      supabase,
      tenantId,
      PRO_EARLY_ACCESS_FEATURE_CODE
    );
  } catch {
    return false;
  }
}

type ProEarlyAccessGateContext = {
  tenant: { id: string };
  membership: { role: string };
};

/**
 * Server guard for /pro. `getContext` must require session, active tenant and
 * active membership (getCurrentContext). Every failure denies access.
 */
export async function proEarlyAccessGate<
  Context extends ProEarlyAccessGateContext,
>(dependencies: {
  getContext: () => Promise<Context | null>;
  hasProEarlyAccess: (tenantId: string) => Promise<boolean>;
}): Promise<{ ok: true; context: Context } | { ok: false }> {
  let context: Context | null;
  try {
    context = await dependencies.getContext();
  } catch {
    return { ok: false };
  }

  if (!context) {
    return { ok: false };
  }

  let enabled: boolean;
  try {
    enabled = await dependencies.hasProEarlyAccess(context.tenant.id);
  } catch {
    return { ok: false };
  }

  if (!canViewProEarlyAccess(context.membership.role, enabled)) {
    return { ok: false };
  }

  return { ok: true, context };
}
