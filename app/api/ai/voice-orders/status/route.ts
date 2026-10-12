import { operationalJson } from "@/lib/http/operational-cache";
import {
  AI_VOICE_MESSAGES,
  assertSameOrigin,
  isVoiceOrdersEnvEnabled,
  requireVoiceOrdersAccess,
  voiceOrdersProviderConfigured,
} from "@/lib/ai/access";
import { loadAiVoiceStatus } from "@/lib/ai/budget";
import {
  DEFAULT_MAX_AUDIO_BYTES,
  DEFAULT_MAX_CLIP_SECONDS,
} from "@/lib/ai/voice-orders/audio";

export async function GET(request: Request) {
  if (!assertSameOrigin(request)) {
    return operationalJson(
      { error: AI_VOICE_MESSAGES.invalidOrigin, code: "invalid_origin" },
      { status: 403 }
    );
  }

  const access = await requireVoiceOrdersAccess();
  if (!access.ok) {
    // Soft status for UI: feature off → disabled panel without hard error UX.
    if (access.response.status === 404 || access.response.status === 503) {
      return operationalJson({
        enabled: false,
        reason:
          access.response.status === 503 ? "ai_unavailable" : "feature_disabled",
        limits: {
          max_clip_seconds: DEFAULT_MAX_CLIP_SECONDS,
          max_audio_bytes: DEFAULT_MAX_AUDIO_BYTES,
        },
        remaining: { user_requests_today: null },
      });
    }
    return access.response;
  }

  const status = await loadAiVoiceStatus(access.supabase, access.context.tenant.id);
  const envReady = isVoiceOrdersEnvEnabled() && voiceOrdersProviderConfigured();
  const enabled = Boolean(
    status?.feature_enabled && status.budget_enabled && envReady
  );

  return operationalJson({
    enabled,
    reason: enabled
      ? null
      : status?.reason ?? (!envReady ? "ai_unavailable" : "disabled"),
    limits: {
      max_clip_seconds:
        status?.limits.max_clip_seconds ?? DEFAULT_MAX_CLIP_SECONDS,
      max_audio_bytes: status?.limits.max_audio_bytes ?? DEFAULT_MAX_AUDIO_BYTES,
    },
    remaining: {
      user_requests_today: status?.remaining.user_requests_today ?? null,
    },
  });
}
