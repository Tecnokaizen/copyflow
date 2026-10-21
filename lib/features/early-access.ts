import { isMembershipRole } from "@/lib/auth/membership-roles";

/**
 * Gestcopy Pro · Acceso anticipado V1
 * (docs/adr/2026-10-15-pro-early-access-v1.md).
 *
 * Program membership is a per-tenant grant in tenant_feature_overrides,
 * resolved by tenant_has_feature. No plan carries it and it is independent of
 * the subscription: it never implies a price, quota or billing state.
 */
export const PRO_EARLY_ACCESS_FEATURE_CODE = "pro_early_access";

/**
 * Catalog code for «Gestcopy AI — Pedidos por voz». The Pro page never
 * resolves it: availability stays "planned" even if the flag is granted.
 * The draft-only voice module (#90, lib/ai/access.ts) gates on it together
 * with AI_VOICE_ORDERS_ENABLED, a provider allowed in this environment and
 * the platform kill switch in ai_usage_limits.
 */
export const AI_VOICE_ORDERS_FEATURE_CODE = "ai_voice_orders";

export const VOICE_ORDERS_V1_STATUS = "planned" as const;

export type EarlyAccessContext =
  | { pro: false }
  | {
      pro: true;
      voice_orders: { status: typeof VOICE_ORDERS_V1_STATUS };
    };

/**
 * `early_access` block of /api/context. Only an explicit `true` enrols the
 * tenant; voice details are sent to enrolled tenants only.
 */
export function earlyAccessContext(proEnabled: unknown): EarlyAccessContext {
  if (proEnabled !== true) {
    return { pro: false };
  }

  return { pro: true, voice_orders: { status: VOICE_ORDERS_V1_STATUS } };
}

/**
 * Any active membership of an enrolled tenant may read the informative page,
 * viewer included. Reading it grants no other permission.
 */
export function canViewProEarlyAccess(role: unknown, featureEnabled: unknown) {
  return featureEnabled === true && isMembershipRole(role);
}

/** Client-side read of /api/context. Missing, malformed or error → hidden. */
export function proEarlyAccessFromContext(context: unknown) {
  if (!context || typeof context !== "object") {
    return false;
  }

  const earlyAccess = (context as { early_access?: unknown }).early_access;
  if (!earlyAccess || typeof earlyAccess !== "object") {
    return false;
  }

  return (earlyAccess as { pro?: unknown }).pro === true;
}
