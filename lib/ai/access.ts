import "server-only";

import { AI_VOICE_ORDERS_FEATURE_CODE } from "@/lib/features/early-access";
import { tenantHasFeature } from "@/lib/features/tenant-has-feature";
import { operationalJson } from "@/lib/http/operational-cache";
import { createClient } from "@/lib/supabase/server";
import { requireCurrentAccess } from "@/lib/tenant/access-response";
import {
  AI_VOICE_MESSAGES,
  canAccessVoiceOrdersModule,
  isVoiceOrdersEnvEnabled,
  voiceOrdersProviderConfigured,
} from "@/lib/ai/voice-orders/feature";

export {
  AI_VOICE_MESSAGES,
  assertSameOrigin,
  canAccessVoiceOrdersModule,
  isVoiceOrdersEnvEnabled,
  voiceOrdersProviderConfigured,
} from "@/lib/ai/voice-orders/feature";

/** Why the voice module is closed for this request (status route maps it). */
export type VoiceAccessDenial =
  | "access"
  | "feature_disabled"
  | "role"
  | "ai_unavailable";

/**
 * Session + active tenant + active membership (requireCurrentAccess, #94),
 * then the tenant grant `ai_voice_orders`, an operative role and the
 * platform switches (env flag and a provider that may run here).
 */
export async function requireVoiceOrdersAccess(route: string) {
  const access = await requireCurrentAccess(route);

  if (!access.ok) {
    return {
      ok: false as const,
      denial: "access" as VoiceAccessDenial,
      response: access.response,
    };
  }

  const context = access.context;
  const supabase = await createClient();
  const enabled = await tenantHasFeature(
    supabase,
    context.tenant.id,
    AI_VOICE_ORDERS_FEATURE_CODE
  );

  if (!enabled) {
    return {
      ok: false as const,
      denial: "feature_disabled" as VoiceAccessDenial,
      response: operationalJson(
        { error: AI_VOICE_MESSAGES.notFound, code: "feature_disabled" },
        { status: 404 }
      ),
    };
  }

  if (!canAccessVoiceOrdersModule(context.membership.role, enabled)) {
    return {
      ok: false as const,
      denial: "role" as VoiceAccessDenial,
      response: operationalJson(
        { error: AI_VOICE_MESSAGES.unauthorized, code: "unauthorized" },
        { status: 403 }
      ),
    };
  }

  if (!isVoiceOrdersEnvEnabled() || !voiceOrdersProviderConfigured()) {
    return {
      ok: false as const,
      denial: "ai_unavailable" as VoiceAccessDenial,
      response: operationalJson(
        { error: AI_VOICE_MESSAGES.unavailable, code: "ai_unavailable" },
        { status: 503 }
      ),
    };
  }

  return {
    ok: true as const,
    context,
    supabase,
  };
}
