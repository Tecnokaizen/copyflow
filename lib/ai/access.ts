import "server-only";

import { tenantHasFeature } from "@/lib/features/tenant-has-feature";
import { operationalJson } from "@/lib/http/operational-cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentContext } from "@/lib/tenant/current-context";
import {
  AI_VOICE_MESSAGES,
  VOICE_ORDERS_FEATURE_CODE,
  canAccessVoiceOrdersModule,
  isVoiceOrdersEnvEnabled,
  voiceOrdersProviderConfigured,
} from "@/lib/ai/voice-orders/feature";

export {
  AI_VOICE_MESSAGES,
  VOICE_ORDERS_FEATURE_CODE,
  assertSameOrigin,
  canAccessVoiceOrdersModule,
  isVoiceOrdersEnvEnabled,
  voiceOrdersProviderConfigured,
} from "@/lib/ai/voice-orders/feature";

export async function requireVoiceOrdersAccess() {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return {
      ok: false as const,
      response: operationalJson(
        { error: AI_VOICE_MESSAGES.unauthenticated, code: "unauthenticated" },
        { status: 401 }
      ),
    };
  }

  const context = await getCurrentContext();

  if (!context) {
    return {
      ok: false as const,
      response: operationalJson(
        { error: AI_VOICE_MESSAGES.unauthorized, code: "unauthorized" },
        { status: 403 }
      ),
    };
  }

  const enabled = await tenantHasFeature(
    supabase,
    context.tenant.id,
    VOICE_ORDERS_FEATURE_CODE
  );

  if (!canAccessVoiceOrdersModule(context.membership.role, enabled)) {
    return {
      ok: false as const,
      response: operationalJson(
        {
          error: enabled
            ? AI_VOICE_MESSAGES.unauthorized
            : AI_VOICE_MESSAGES.notFound,
          code: enabled ? "unauthorized" : "feature_disabled",
        },
        { status: enabled ? 403 : 404 }
      ),
    };
  }

  if (!isVoiceOrdersEnvEnabled() || !voiceOrdersProviderConfigured()) {
    return {
      ok: false as const,
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
    user,
  };
}
